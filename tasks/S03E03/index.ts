import axios from 'axios';
import { openAIClient } from '../../services/openai/openai';
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

const DB_API_URL = 'https://c3ntrala.ag3nts.org/apidb';

async function dbQuery(query: string): Promise<DbApiResponse> {
  const apikey = process.env.CENTRALA_SECRET || '';
  const payload = {
    task: 'database',
    apikey,
    query,
  };

  console.log('\n[DB] Request:', JSON.stringify(payload, null, 2));
  const { data } = await axios.post<DbApiResponse>(DB_API_URL, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  console.log('[DB] Response:', JSON.stringify(data, null, 2));
  return data;
}

function normalizeRawSql(sql: string): string {
  // Remove markdown fences and surrounding noise, keep a single SQL statement
  let s = sql.trim();
  s = s.replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z]*\n?|```/g, ''));
  s = s.replace(/^```.*\n|```$/g, '').trim();
  // Strip leading/trailing quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  // If multiple statements somehow, take the first SELECT
  const selectMatch = s.match(/select[\s\S]*?;?/i);
  if (selectMatch) {
    s = selectMatch[0];
  }
  // Ensure no extra commentary around
  return s.trim();
}

async function discoverSchemas(): Promise<Record<string, string>> {
  const schemas: Record<string, string> = {};

  const tablesRes = await dbQuery('SHOW TABLES;');
  const tableNames: string[] = [];

  // Try to detect table names from typical shapes
  if (Array.isArray(tablesRes?.data)) {
    for (const row of tablesRes.data as Array<Record<string, unknown>>) {
      const values = Object.values(row);
      for (const v of values) {
        if (typeof v === 'string') tableNames.push(v);
      }
    }
  } else if (Array.isArray(tablesRes?.rows)) {
    for (const row of tablesRes.rows) {
      const values = Object.values(row);
      for (const v of values) {
        if (typeof v === 'string') tableNames.push(v);
      }
    }
  } else if (Array.isArray(tablesRes?.reply)) {
    for (const row of tablesRes.reply as Array<Record<string, unknown>>) {
      const values = Object.values(row);
      for (const v of values) {
        if (typeof v === 'string') tableNames.push(v);
      }
    }
  }

  const interesting = ['users', 'datacenters', 'connections'];
  for (const name of interesting) {
    if (tableNames.includes(name)) {
      const ddlRes = await dbQuery(`SHOW CREATE TABLE ${name};`);
      // Find the DDL text in common shapes
      let ddl = '';
      const candidates: Array<Record<string, unknown>> = [];
      if (Array.isArray(ddlRes?.data)) candidates.push(...(ddlRes.data as Array<Record<string, unknown>>));
      if (Array.isArray(ddlRes?.rows)) candidates.push(...ddlRes.rows);
      if (Array.isArray(ddlRes?.reply)) candidates.push(...(ddlRes.reply as Array<Record<string, unknown>>));
      for (const row of candidates) {
        for (const [k, v] of Object.entries(row)) {
          if (typeof v === 'string' && (/CREATE TABLE/i.test(v) || k.toLowerCase().includes('create'))) {
            ddl = v;
            break;
          }
        }
        if (ddl) break;
      }
      // Fallback - stringify all
      if (!ddl) ddl = JSON.stringify(ddlRes);
      schemas[name] = ddl;
    }
  }

  return schemas;
}

async function generateSql(schemas: Record<string, string>): Promise<string> {
  const system = 'You are a senior SQL engineer. Output only one SQL SELECT statement. No prose, no markdown, no comments.';
  const ddlText = Object.entries(schemas)
    .map(([name, ddl]) => `-- ${name}\n${ddl}`)
    .join('\n\n');
  const user = `Baza danych (DDL):\n\n${ddlText}\n\nZadanie: Zwróć identyfikatory czynnych (is_active = 1) datacenter z tabeli datacenters, których menadżerowie z tabeli users są nieaktywni (is_active = 0).\n\nWymagania:\n- Zwróć jedną kolumnę o nazwie id (użyj aliasu jeśli to inna nazwa klucza), zawierającą ID datacenter.\n- Zwróć tylko i wyłącznie surowe SQL, bez formatowania i bez wyjaśnień.\n- Jedno zapytanie SELECT.`;

  const raw = await openAIClient.question(system, user);
  let sql = normalizeRawSql(raw);
  console.log('\n[LLM] Raw SQL:\n', sql);
  // quick validity check
  const lower = sql.toLowerCase();
  if (!/select\s+[\s\S]*from\s+/i.test(sql) || lower === 'select' || lower.length < 20) {
    sql = '';
  }
  return sql;
}

function buildFallbackSql(): string {
  // Based on discovered DDLs
  return 'SELECT dc.dc_id AS id FROM datacenters dc JOIN users u ON u.id = dc.manager WHERE dc.is_active = 1 AND u.is_active = 0;';
}

function extractIdsFromDbResponse(res: DbApiResponse): number[] {
  const rows: Array<Record<string, unknown>> = [];
  if (Array.isArray(res?.data)) {
    if (res.data.length > 0 && typeof res.data[0] === 'object') {
      rows.push(...(res.data as Array<Record<string, unknown>>));
    }
  }
  if (Array.isArray(res?.rows)) rows.push(...res.rows);
  if (Array.isArray(res?.reply)) rows.push(...(res.reply as Array<Record<string, unknown>>));

  const ids: number[] = [];
  for (const row of rows) {
    // Prefer explicit 'id' or 'dc_id' columns
    const candidates = ['id', 'dc_id', 'DC_ID', 'datacenter_id'];
    let value: unknown = undefined;
    for (const c of candidates) {
      if (c in row) {
        value = row[c];
        break;
      }
    }
    // If not found, take the first numeric value in the row
    if (value === undefined) {
      const firstNumeric = Object.values(row).find((v) => typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)));
      value = firstNumeric;
    }
    if (typeof value === 'number') ids.push(value);
    else if (typeof value === 'string' && /^\d+$/.test(value)) ids.push(Number(value));
  }

  // Deduplicate and sort for stability
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

async function run(): Promise<void> {
  try {
    if (!process.env.CENTRALA_SECRET) {
      console.warn('Brak CENTRALA_SECRET w środowisku.');
    }
    if (!process.env.OPENAI_API_KEY) {
      console.warn('Brak OPENAI_API_KEY w środowisku. Generowanie SQL może się nie powieść.');
    }

    // 1) Odkryj schemat
    const schemas = await discoverSchemas();
    if (!schemas.datacenters || !schemas.users) {
      console.warn('Uwaga: Nie wykryto wszystkich oczekiwanych tabel (users/datacenters). Spróbuję mimo to.');
    }

    // 2) Wygeneruj zapytanie przez LLM (surowe SQL)
    let sql = await generateSql(schemas);
    if (!sql) {
      console.warn('LLM nie zwrócił poprawnego SQL – używam zapytania awaryjnego.');
      sql = buildFallbackSql();
      console.log('[FALLBACK SQL]:', sql);
    }

    // 3) Wykonaj zapytanie
    const result = await dbQuery(sql);
    if (result?.error && result.error !== 'OK') {
      throw new Error(`DB error: ${result.error}`);
    }

    // 4) Ekstrakcja ID
    const ids = extractIdsFromDbResponse(result);
    console.log('\n[RESULT] IDs:', ids);

    // 5) Raport do centrali
    console.log('\nWysyłanie odpowiedzi do centrali...');
    const flag = await centralaClient.report('database', ids);
    console.log('Odpowiedź centrali:', flag.data);
  } catch (error) {
    console.error('Błąd w zadaniu S03E03:', error);
    process.exitCode = 1;
  }
}

run().catch(console.error);


