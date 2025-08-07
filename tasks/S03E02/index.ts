import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import OpenAI from 'openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import { randomUUID } from 'crypto';
import { centralaClient } from '../../clients/centrala/client';

const EMBEDDING_MODEL = 'text-embedding-3-large'; // 3072 dims
const VECTOR_SIZE = 3072;
const COLLECTION = 'weapons_tests';

function getTaskDir(): string {
  return new URL('.', import.meta.url).pathname;
}

function parseDateFromFilename(filename: string): string | null {
  // Support 2024-01-08 or 2024_01_08
  const hyphen = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (hyphen && hyphen[1]) return hyphen[1];
  const underscore = filename.match(/(\d{4})_(\d{2})_(\d{2})/);
  if (underscore) {
    return `${underscore[1]}-${underscore[2]}-${underscore[3]}`;
  }
  return null;
}

async function readReportsFromDir(dir: string): Promise<Array<{ filename: string; date: string; text: string }>> {
  const out: Array<{ filename: string; date: string; text: string }> = [];
  const stack: string[] = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(current, e.name);
      if (e.isDirectory()) {
        stack.push(p);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.txt')) {
        const date = parseDateFromFilename(e.name);
        if (!date) continue;
        const text = await fs.readFile(p, 'utf-8');
        out.push({ filename: e.name, date, text });
      }
    }
  }
  // Keep deterministic order
  out.sort((a, b) => a.filename.localeCompare(b.filename));
  return out;
}

async function ensureCollection(client: any): Promise<void> {
  // Wait for Qdrant readiness (simple retry)
  let attempts = 0;
  const maxAttempts = 30;
  while (attempts < maxAttempts) {
    try {
      await client.getCollections();
      break;
    } catch {
      attempts += 1;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  // Recreate to ensure correct vector size and clean state
  try { await client.deleteCollection(COLLECTION); } catch {}
  await client.createCollection(COLLECTION, {
    vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
  });
}

async function embedText(client: OpenAI, text: string): Promise<number[]> {
  const res = await client.embeddings.create({ model: EMBEDDING_MODEL, input: text });
  if (!res.data || res.data.length === 0) {
    throw new Error('Empty embeddings response');
  }
  const embedding = res.data[0]?.embedding;
  if (!embedding) {
    throw new Error('No embedding in response');
  }
  return embedding as unknown as number[];
}

async function indexReports(): Promise<void> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL || 'http://localhost:6333' });

  await ensureCollection(qdrant);

  const baseDir = getTaskDir();
  const dataDir = path.join(baseDir, 'weapons_tests');
  const reports = await readReportsFromDir(dataDir);

  const points = [] as Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>; 
  for (const r of reports) {
    const vector = await embedText(openai, r.text);
    points.push({
      id: randomUUID(),
      vector,
      payload: { date: r.date, filename: r.filename },
    });
  }

  if (points.length > 0) {
    await qdrant.upsert(COLLECTION, { points });
  }
}

async function answerQuestion(): Promise<string> {
  const question = 'W raporcie, z którego dnia znajduje się wzmianka o kradzieży prototypu broni?';
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL || 'http://localhost:6333' });

  const queryVector = await embedText(openai, question);
  const results = await qdrant.search(COLLECTION, {
    vector: queryVector,
    limit: 1,
    with_payload: true,
  });

  if (!results || results.length === 0) {
    throw new Error('No results from vector search');
  }

  const top = results[0]!;
  const payload = (top.payload ? top.payload : undefined) as Record<string, unknown> | undefined;
  const date = (payload && (payload.date as string)) || '';
  if (!date) throw new Error('Date not found in payload');
  return date;
}

async function reportToCentrala(date: string): Promise<void> {
  const flag = await centralaClient.report('wektory', date);
  console.log('Centrala response:', flag.data);
}

async function run(): Promise<void> {
  try {
    await indexReports();
    const date = await answerQuestion();
    console.log('Detected date:', date);
    await reportToCentrala(date);
  } catch (err) {
    console.error('Error in S03E02 task:', err);
    process.exit(1);
  }
}

run();


