import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { centralaClient } from '../../clients/centrala/client';

type DbApiResponse = {
  status?: string;
  error?: string;
  columns?: string[];
  data?: Array<Record<string, unknown>> | Array<unknown>;
  rows?: Array<Record<string, unknown>>;
  reply?: Array<Record<string, unknown>> | Record<string, unknown> | null;
  result?: any;
};

type UserRecord = {
  id: number;
  name: string;
};

type ConnectionPair = {
  a: number;
  b: number;
};

const DB_API_URL = 'https://c3ntrala.ag3nts.org/apidb';
const CACHE_DIR = path.resolve(process.cwd(), 'tasks', 'S03E05', 'analyzed');

async function dbQuery(query: string): Promise<DbApiResponse> {
  const apikey = process.env.CENTRALA_SECRET || '';
  const payload = {
    task: 'database',
    apikey,
    query,
  };

  const { data } = await axios.post<DbApiResponse>(DB_API_URL, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 20000,
  });
  return data;
}

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function writeJson(file: string, value: unknown): void {
  ensureCacheDir();
  fs.writeFileSync(path.join(CACHE_DIR, file), JSON.stringify(value, null, 2), 'utf-8');
}

function readJson<T>(file: string): T | null {
  try {
    const p = path.join(CACHE_DIR, file);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function removeDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L');
}

function normalizeNameForMatch(input: string): string {
  return removeDiacritics(input.trim()).toLowerCase();
}

function extractRows(res: DbApiResponse): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  if (Array.isArray(res?.data)) {
    if (res.data.length > 0 && typeof res.data[0] === 'object') rows.push(...(res.data as Array<Record<string, unknown>>));
  }
  if (Array.isArray(res?.rows)) rows.push(...res.rows);
  if (Array.isArray(res?.reply)) rows.push(...(res.reply as Array<Record<string, unknown>>));
  return rows;
}

async function fetchUsers(): Promise<UserRecord[]> {
  const cached = readJson<UserRecord[]>('users.json');
  if (cached && cached.length > 0) return cached;

  const preferred = ['name', 'username', 'first_name', 'firstname', 'full_name', 'fullname'];
  // Try preferred columns one by one
  for (const col of preferred) {
    try {
      const res = await dbQuery(`SELECT id, ${col} AS name FROM users WHERE ${col} IS NOT NULL`);
      const rows = extractRows(res);
      const users: UserRecord[] = [];
      for (const r of rows) {
        const idVal = r.id as number | string | undefined;
        const nm = r.name as string | undefined;
        if ((typeof idVal === 'number' || (typeof idVal === 'string' && /^\d+$/.test(idVal))) && typeof nm === 'string' && nm.trim().length > 0) {
          users.push({ id: Number(idVal), name: nm });
        }
      }
      if (users.length > 0) {
        writeJson('users.json', users);
        writeJson('users_name_column.json', { column: col });
        return users;
      }
    } catch {
      // try next
    }
  }
  // Fallback: infer from SELECT *
  const res = await dbQuery('SELECT * FROM users');
  const rows = extractRows(res);
  const users: UserRecord[] = [];
  if (rows.length > 0) {
    const sample = rows[0] as Record<string, unknown>;
    // Determine id column
    const keys = Object.keys(sample as object);
    const idKey: string = (keys.find((k) => k.toLowerCase() === 'id')
      || keys.find((k) => typeof (sample as any)[k] === 'number' || /^\d+$/.test(String((sample as any)[k])))
      || 'id') as string;
    // Determine name column: a string-like field
    const nameKey: string = (keys.find((k) => preferred.includes(k.toLowerCase()))
      || keys.find((k) => typeof (sample as any)[k] === 'string' && k.toLowerCase() !== 'id')
      || 'name') as string;
    for (const r of rows) {
      const idVal = (r as any)[idKey] as number | string | undefined;
      const nm = (r as any)[nameKey] as string | undefined;
      if ((typeof idVal === 'number' || (typeof idVal === 'string' && /^\d+$/.test(idVal))) && typeof nm === 'string' && nm.trim().length > 0) {
        users.push({ id: Number(idVal), name: nm });
      }
    }
  }
  writeJson('users.json', users);
  return users;
}

async function fetchConnections(users?: UserRecord[]): Promise<ConnectionPair[]> {
  const cached = readJson<ConnectionPair[]>('connections.json');
  if (cached && cached.length > 0) return cached;

  const idSet = new Set((users || []).map((u) => u.id));
  const pairs: Array<[string, string]> = [
    ['user1_id', 'user2_id'],
    ['user_id_1', 'user_id_2'],
    ['from_user', 'to_user'],
    ['from_id', 'to_id'],
    ['src', 'dst'],
    ['a', 'b'],
    ['u1', 'u2'],
  ];
  // Try candidate pairs quickly
  for (const [aCol, bCol] of pairs) {
    try {
      const test = await dbQuery(`SELECT ${aCol} AS a, ${bCol} AS b FROM connections LIMIT 10`);
      const rows = extractRows(test);
      const edges: ConnectionPair[] = [];
      for (const r of rows) {
        const av = r.a as number | string | undefined;
        const bv = r.b as number | string | undefined;
        const a = typeof av === 'number' ? av : typeof av === 'string' && /^\d+$/.test(av) ? Number(av) : NaN;
        const b = typeof bv === 'number' ? bv : typeof bv === 'string' && /^\d+$/.test(bv) ? Number(bv) : NaN;
        if (Number.isFinite(a) && Number.isFinite(b)) edges.push({ a, b });
      }
      if (edges.length > 0) {
        const full = await dbQuery(`SELECT ${aCol} AS a, ${bCol} AS b FROM connections`);
        const allRows = extractRows(full);
        const allEdges: ConnectionPair[] = [];
        for (const r of allRows) {
          const av = r.a as number | string | undefined;
          const bv = r.b as number | string | undefined;
          const a = typeof av === 'number' ? av : typeof av === 'string' && /^\d+$/.test(av) ? Number(av) : NaN;
          const b = typeof bv === 'number' ? bv : typeof bv === 'string' && /^\d+$/.test(bv) ? Number(bv) : NaN;
          if (Number.isFinite(a) && Number.isFinite(b)) allEdges.push({ a, b });
        }
        writeJson('connections.json', allEdges);
        writeJson('connections_columns.json', { a: aCol, b: bCol });
        return allEdges;
      }
    } catch {
      // try next pair
    }
  }

  // Fallback: infer from SELECT * and pick two numeric columns best matching user ids
  const res = await dbQuery('SELECT * FROM connections');
  const rows = extractRows(res);
  const edges: ConnectionPair[] = [];
  if (rows.length > 0) {
    const sample = rows[0] as Record<string, unknown>;
    const keys = Object.keys(sample);
    const numericCols = keys.filter((k) => {
      const v = (sample as any)[k];
      return typeof v === 'number' || /^\d+$/.test(String(v));
    });
    let bestPair: [string, string] | null = null;
    let bestScore = -1;
    for (let i = 0; i < numericCols.length; i++) {
      for (let j = i + 1; j < numericCols.length; j++) {
        const aKey = numericCols[i] as string;
        const bKey = numericCols[j] as string;
        let score = 0;
        for (const r of rows.slice(0, Math.min(rows.length, 200))) {
          const av = (r as any)[aKey];
          const bv = (r as any)[bKey];
          const a = typeof av === 'number' ? av : typeof av === 'string' && /^\d+$/.test(av) ? Number(av) : NaN;
          const b = typeof bv === 'number' ? bv : typeof bv === 'string' && /^\d+$/.test(bv) ? Number(bv) : NaN;
          if (Number.isFinite(a) && Number.isFinite(b)) {
            // Bonus if matches known user ids
            if (idSet.size === 0 || (idSet.has(a) && idSet.has(b))) score += 1;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestPair = [aKey as string, bKey as string];
        }
      }
    }
    if (numericCols.length < 2) {
      writeJson('connections.json', edges);
      return edges;
    }
    const [aKey, bKey] = (bestPair ?? [numericCols[0] as string, numericCols[1] as string]) as [string, string];
    for (const r of rows) {
      const av = (r as any)[aKey];
      const bv = (r as any)[bKey];
      const a = typeof av === 'number' ? av : typeof av === 'string' && /^\d+$/.test(av) ? Number(av) : NaN;
      const b = typeof bv === 'number' ? bv : typeof bv === 'string' && /^\d+$/.test(bv) ? Number(bv) : NaN;
      if (Number.isFinite(a) && Number.isFinite(b)) edges.push({ a, b });
    }
  }
  writeJson('connections.json', edges);
  return edges;
}

function buildAdjacency(connections: ConnectionPair[]): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  const add = (x: number, y: number) => {
    if (!adj.has(x)) adj.set(x, new Set());
    adj.get(x)!.add(y);
  };
  for (const { a, b } of connections) {
    // Treat as undirected for path discovery
    add(a, b);
    add(b, a);
  }
  return adj;
}

function bfsShortestPath(adj: Map<number, Set<number>>, start: number, goal: number): number[] | null {
  if (start === goal) return [start];
  const queue: number[] = [start];
  const visited = new Set<number>([start]);
  const parent = new Map<number, number>();
  while (queue.length > 0) {
    const u = queue.shift()!;
    const neighbors = adj.get(u) || new Set<number>();
    for (const v of neighbors) {
      if (visited.has(v)) continue;
      visited.add(v);
      parent.set(v, u);
      if (v === goal) {
        const path: number[] = [v];
        let cur = v;
        while (parent.has(cur)) {
          const p = parent.get(cur)!;
          path.push(p);
          cur = p;
        }
        path.reverse();
        return path;
      }
      queue.push(v);
    }
  }
  return null;
}

async function computeNeo4jShortestPath(users: UserRecord[], connections: ConnectionPair[], startId: number, goalId: number): Promise<number[]> {
  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USER || 'neo4j';
  const password = process.env.NEO4J_PASSWORD || 'neo4j';
  if (!uri) throw new Error('NEO4J_URI nie jest ustawione – wymagane do uruchomienia zadania.');
  try {
    // Dynamic import to avoid hard dependency if not used
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const neo4j: any = await import('neo4j-driver');
    const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    const session = driver.session();
    try {
      // Wait for Neo4j to be ready
      let ready = false;
      for (let i = 0; i < 60; i++) {
        try {
          await session.run('RETURN 1');
          ready = true;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (!ready) throw new Error('Neo4j nie jest gotowy do połączenia.');

      // Reset database (optional) and load data
      await session.run('MATCH (n) DETACH DELETE n');
      // Ensure uniqueness on userId
      await session.run('CREATE CONSTRAINT person_userid IF NOT EXISTS FOR (p:Person) REQUIRE p.userId IS UNIQUE');
      // Create nodes
      for (const u of users) {
        await session.run(
          'CREATE (p:Person { userId: $userId, username: $username })',
          { userId: u.id, username: u.name }
        );
      }
      // Create relations (directed both ways for undirected semantics)
      for (const e of connections) {
        await session.run(
          'MATCH (a:Person { userId: $a }), (b:Person { userId: $b }) CREATE (a)-[:KNOWS]->(b) CREATE (b)-[:KNOWS]->(a)',
          { a: e.a, b: e.b }
        );
      }
      // Shortest path query
      const result = await session.run(
        'MATCH (start:Person { userId: $startId }), (goal:Person { userId: $goalId }), p = shortestPath((start)-[:KNOWS*..20]->(goal)) RETURN [n IN nodes(p) | n.userId] AS ids',
        { startId, goalId }
      );
      const rec = result.records?.[0];
      if (!rec) throw new Error('Neo4j nie zwrócił ścieżki.');
      const ids = rec.get('ids') as number[] | null;
      if (Array.isArray(ids) && ids.length > 0) return ids;
      throw new Error('Neo4j nie zwrócił poprawnej listy identyfikatorów.');
    } finally {
      await session.close();
      await driver.close();
    }
  } catch (e) {
    throw e instanceof Error ? e : new Error('Błąd Neo4j');
  }
}

async function run(): Promise<void> {
  try {
    if (!process.env.CENTRALA_SECRET) {
      console.warn('Brak CENTRALA_SECRET w środowisku.');
    }
    if (!process.env.CENTRALA_URL) {
      console.warn('Brak CENTRALA_URL w środowisku. Raportowanie może się nie powieść.');
    }

    console.log('Pobieram użytkowników i połączenia z MySQL (przez /apidb)...');
    const users = await fetchUsers();
    const connections = await fetchConnections(users);
    console.log(`Użytkownicy: ${users.length}, połączenia: ${connections.length}`);

    const nameToId = new Map<string, number[]>();
    for (const u of users) {
      const norm = normalizeNameForMatch(u.name);
      if (!nameToId.has(norm)) nameToId.set(norm, []);
      nameToId.get(norm)!.push(u.id);
    }

    const startCandidates = nameToId.get(normalizeNameForMatch('Rafał')) || nameToId.get(normalizeNameForMatch('Rafal')) || [];
    const goalCandidates = nameToId.get(normalizeNameForMatch('Barbara')) || [];
    if (startCandidates.length === 0 || goalCandidates.length === 0) {
      throw new Error('Nie znaleziono wymaganych osób w tabeli users (Rafał/Barbara).');
    }
    const startId = startCandidates[0]!;
    const goalId = goalCandidates[0]!;

    // Wymagane: użyj Neo4j do wyznaczenia ścieżki
    const idPath = await computeNeo4jShortestPath(users, connections, startId, goalId);

    const idToName = new Map(users.map((u) => [u.id, u.name] as const));
    const namesPath = idPath.map((id) => idToName.get(id) || String(id));
    const answer = namesPath.join(',');

    console.log('Ścieżka:', answer);

    console.log('Wysyłanie odpowiedzi do centrali...');
    const flag = await centralaClient.report('connections', answer);
    console.log('Odpowiedź centrali:', flag.data);
  } catch (err) {
    console.error('Błąd w zadaniu S03E05:', err);
    process.exitCode = 1;
  }
}

run().catch(console.error);


