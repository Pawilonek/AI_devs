import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { openAIClient } from '../../services/openai/openai.ts';

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function listFragmentFiles(fragmentsDir: string): string[] {
  if (!fs.existsSync(fragmentsDir)) return [];
  const files = fs
    .readdirSync(fragmentsDir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => path.resolve(fragmentsDir, f));
  // Sort by numeric index if present in filename
  files.sort((a, b) => {
    const an = Number(a.match(/(\d+)/)?.[1] ?? '0');
    const bn = Number(b.match(/(\d+)/)?.[1] ?? '0');
    if (an !== bn) return an - bn;
    return a.localeCompare(b);
  });
  return files;
}

function toDataUriPng(absPath: string): string {
  const bytes = fs.readFileSync(absPath);
  const b64 = Buffer.from(bytes).toString('base64');
  return `data:image/png;base64,${b64}`;
}

async function transcribeImage(absPath: string): Promise<string> {
  const dataUrl = toDataUriPng(absPath);
  const system = 'You are a meticulous transcription assistant. Return only the raw text you can read from the image. No commentary, no formatting, no guessing beyond clearly legible glyphs.';
  const content = [
    { type: 'text', text: 'Transcribe all clearly legible text from this fragment. Return plain text only.' },
    { type: 'image_url', image_url: { url: dataUrl } }
  ] as any[];
  const txt = await openAIClient.vision(system, content);
  return txt.trim();
}

async function main() {
  const baseDir = path.resolve(process.cwd(), 'tasks/S04E05/context');
  const fragmentsDir = path.join(baseDir, 'fragments');
  const outMd = path.join(baseDir, 'page19_fragments_transcription.md');
  ensureDir(baseDir);

  const files = listFragmentFiles(fragmentsDir);
  if (files.length === 0) {
    console.error(`No fragment PNGs found in ${fragmentsDir}`);
    process.exit(1);
  }

  let md = '# Page 19 – Fragments Transcription\n\n';
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const name = path.basename(file);
    process.stdout.write(`Transcribing (${i + 1}/${files.length}): ${name}... `);
    try {
      const text = await transcribeImage(file);
      md += `## ${name}\n\n`;
      if (text) {
        md += `${text}\n\n`;
      } else {
        md += '_(no text detected)_\n\n';
      }
      console.log('ok');
    } catch (err) {
      console.log('failed');
      md += `## ${name}\n\n_(error during transcription)_\n\n`;
    }
    md += '---\n\n';
  }

  fs.writeFileSync(outMd, md, 'utf8');
  console.log(`Saved transcription: ${outMd}`);
}

main().catch((err) => {
  console.error('Error in transcribe_fragments:', err);
  process.exit(1);
});


