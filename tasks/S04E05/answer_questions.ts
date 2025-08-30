import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { openAIClient } from '../../services/openai/openai.ts';
import { centralaClient } from '../../clients/centrala/client';
import crypto from 'crypto';

type QuestionsRecord = Record<string, string>;

function readAllMarkdown(contextDir: string): { combined: string; files: string[] } {
  if (!fs.existsSync(contextDir)) {
    throw new Error(`Context directory not found: ${contextDir}`);
  }
  const entries = fs
    .readdirSync(contextDir, { withFileTypes: true })
    .filter((ent) => ent.isFile() && ent.name.toLowerCase().endsWith('.md'))
    .map((ent) => ent.name);

  // Prioritize the main notebook text first if present
  const preferredOrder = [
    'notatnik-rafala.md',
    'page19_fragments_transcription.md',
  ];
  const ordered = [
    ...preferredOrder.filter((p) => entries.includes(p)),
    ...entries.filter((e) => !preferredOrder.includes(e)).sort((a, b) => a.localeCompare(b)),
  ];

  const parts: string[] = [];
  for (const file of ordered) {
    const abs = path.resolve(contextDir, file);
    const content = fs.readFileSync(abs, 'utf8');
    parts.push(`\n\n<!-- BEGIN ${file} -->\n`);
    if (file.includes('page19')) {
      parts.push('Uwaga: Tekst ze strony 19 pochodzi z OCR i może zawierać błędy.');
    }
    parts.push(content);
    parts.push(`\n<!-- END ${file} -->\n`);
  }

  return { combined: parts.join('\n'), files: ordered };
}

function readQuestions(questionsPath: string): QuestionsRecord {
  if (!fs.existsSync(questionsPath)) {
    throw new Error(`Questions file not found: ${questionsPath}`);
  }
  const raw = fs.readFileSync(questionsPath, 'utf8');
  const data = JSON.parse(raw);
  if (Array.isArray(data)) {
    return data.reduce<QuestionsRecord>((acc, q, idx) => {
      acc[String(idx + 1).padStart(2, '0')] = String(q);
      return acc;
    }, {});
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if ('questions' in data && typeof (data as any).questions === 'object') {
      return (data as any).questions as QuestionsRecord;
    }
    return data as QuestionsRecord;
  }
  throw new Error('Unsupported questions.json shape');
}

function buildSystemPrompt(): string {
  return [
    'Masz kompletny tekst notatnika Rafała (strony 1–18 z PDF oraz transkrypcję OCR strony 19).',
    'Odpowiadaj zwięźle, bazując przede wszystkim na tekście. Jeśli odpowiedź wymaga wnioskowania – wnioskuj, ale nie fantazjuj.',
    'Zwracaj tylko krótką odpowiedź bez dodatkowych komentarzy.',
  ].join(' ');
}

function buildUserPrompt(
  questionKey: string,
  question: string,
  context: string,
  previous?: string,
  hint?: string,
  savedHintsText?: string
): string {
  const hints: Record<string, string> = {
    '01': 'To może wymagać dedukcji; odpowiedź nie jest podana wprost w jednym zdaniu.',
    '03': 'Upewnij się, że uwzględniasz drobny, szary podpis pod rysunkiem, jeśli jest dostępny.',
    '04': 'Jeśli pytanie dotyczy dat względnych, postaraj się wyliczyć dokładną datę na podstawie treści.',
    '05': 'Nazwa miejscowości pochodzi z OCR i może zawierać błędy; rozważ korektę na podstawie kontekstu.',
  };

  const extraParts: string[] = [];
  if (hints[questionKey]) extraParts.push(`Wskazówka: ${hints[questionKey]}`);
  if (previous) extraParts.push(`Poprzednia odpowiedź była błędna: "${previous}" – nie powtarzaj jej.`);
  if (hint) extraParts.push(`Podpowiedź z centrali: ${hint}`);
  if (savedHintsText && savedHintsText.trim()) {
    extraParts.push('Skorzystaj z poniższych zapisanych podpowiedzi (globalnych i per pytanie):');
    extraParts.push(savedHintsText.trim());
  }
  const extra = extraParts.length ? `\n${extraParts.join('\n')}` : '';

  // Limit context length to avoid overly long prompts
  const maxChars = 180000; // generous, relies on model to handle
  const ctx = context.length > maxChars ? context.slice(0, maxChars) + '\n...[truncated]...' : context;

  return [
    'Kontekst notatnika (Markdown):',
    ctx,
    '',
    `Pytanie (${questionKey}): ${question}`,
    extra,
    '',
    'Zwróć wyłącznie odpowiedź, bez wstępu ani wyjaśnień.',
  ].join('\n');
}

function extractHints(respData: any): Record<string, string> | null {
  if (!respData) return null;
  if (typeof respData === 'string') return null;
  if (typeof respData === 'object') {
    // Case 1: dictionary of hints
    const hintsObj = (respData.hints || respData.errors || null);
    if (hintsObj && typeof hintsObj === 'object') {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(hintsObj)) {
        if (typeof v === 'string') out[k] = v;
        else if (v && typeof v === 'object' && 'hint' in (v as any) && typeof (v as any).hint === 'string') {
          out[k] = (v as any).hint as string;
        }
      }
      if (Object.keys(out).length) return out;
    }

    // Case 2: single top-level hint string, try mapping to question from message
    if (typeof (respData as any).hint === 'string') {
      const hintStr = String((respData as any).hint).trim();
      const msg: string | undefined = typeof (respData as any).message === 'string' ? (respData as any).message : undefined;
      const match = msg?.match(/question\s*(\d{1,2})/i);
      if (match) {
        const key = match[1] ? String(match[1]).padStart(2, '0') : 'global';
        return { [key]: hintStr };
      }
      return { global: hintStr } as Record<string, string>;
    }
  }
  return null;
}

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function toSha1(text: string): string {
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex');
}

function saveHintsAsMarkdown(hintsDir: string, hints: Record<string, string>) {
  if (!hints || Object.keys(hints).length === 0) return;
  ensureDir(hintsDir);
  for (const [key, hintText] of Object.entries(hints)) {
    const scope = /^\d{2}$/.test(key) ? key : 'global';
    const hash = toSha1(hintText).slice(0, 12);
    const fileName = `hint_${scope}_${hash}.md`;
    const abs = path.join(hintsDir, fileName);
    if (fs.existsSync(abs)) continue; // already saved
    const header = scope === 'global' ? '# Hint (global)' : `# Hint for ${scope}`;
    const content = `${header}\n\n${hintText}\n`;
    fs.writeFileSync(abs, content, 'utf8');
  }
}

function collectSavedHintsForKey(hintsDir: string, key: string): string {
  if (!fs.existsSync(hintsDir)) return '';
  const files = fs.readdirSync(hintsDir).filter((f) => f.toLowerCase().endsWith('.md'));
  const wanted = new Set([`hint_${key}_`, 'hint_global_']);
  const parts: string[] = [];
  for (const f of files) {
    if ([...wanted].some((p) => f.startsWith(p))) {
      const abs = path.join(hintsDir, f);
      const txt = fs.readFileSync(abs, 'utf8').trim();
      const body = txt.replace(/^# .*\n?/, '').trim();
      if (body) parts.push(body);
    }
  }
  return parts.length ? `Zapisane podpowiedzi:\n- ${parts.join('\n- ')}` : '';
}

async function main() {
  const contextDir = path.resolve(process.cwd(), 'tasks/S04E05/context');
  const questionsPath = path.resolve(process.cwd(), 'tasks/S04E05/source/questions.json');
  const hintsMdDir = path.resolve(contextDir, 'hints');

  const { combined, files } = readAllMarkdown(contextDir);
  const questions = readQuestions(questionsPath);

  console.log('Using context files:');
  files.forEach((f) => console.log(` - ${f}`));
  console.log('');

  const keys = Object.keys(questions).sort();
  const system = buildSystemPrompt();

  const maxAttempts = Number(process.env.S04E05_MAX_ATTEMPTS || 4);
  let attempt = 0;
  let previousAnswers: Partial<Record<string, string>> = {};
  let carryHints: Partial<Record<string, string>> = {};

  while (attempt < maxAttempts) {
    attempt += 1;
    console.log(`\nAttempt ${attempt}/${maxAttempts} – generating answers...`);
    const answers: Record<string, string> = {};
    for (const key of keys) {
      const q = questions[key];
      if (!q) continue;
      const savedHintsSection = collectSavedHintsForKey(hintsMdDir, key);
      const user = buildUserPrompt(
        key,
        q,
        combined,
        previousAnswers[key],
        carryHints[key],
        savedHintsSection
      );
      const ans = await openAIClient.question(system, user, 'gpt-4.1');
      answers[key] = ans.trim();
    }

    // Print to stdout as before
    keys.forEach((k) => {
      if (answers[k]) console.log(`${k}: ${answers[k]}`);
    });

    console.log('Sending answers to centrala...');
    let newHints: Record<string, string> | null = null;
    try {
      const resp = await centralaClient.report('notes', answers);
      const data = resp?.data ?? resp;
      console.log('Centrala response:', typeof data === 'string' ? data : JSON.stringify(data));
      newHints = extractHints(data);
    } catch (err) {
      // err is expected to be server response data, try to extract hints
      const data = err;
      console.log('Centrala error response:', typeof data === 'string' ? data : JSON.stringify(data));
      newHints = extractHints(data);
    }

    if (newHints) {
      saveHintsAsMarkdown(hintsMdDir, newHints);
    }
    if (!newHints || Object.keys(newHints).length === 0) {
      console.log('No machine-readable hints found. Stopping.');
      break;
    }
    console.log('Received hints for keys:', Object.keys(newHints).join(', '));
    previousAnswers = { ...answers };
    carryHints = { ...newHints };
  }
}

main().catch((err) => {
  console.error('Fatal error in answer_questions:', err);
  process.exit(1);
});


