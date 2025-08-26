import 'dotenv/config';
import axios from 'axios';
// no path imports needed
import { centralaClient } from '../../clients/centrala/client';
import { openAIClient } from '../../services/openai/openai';

type QuestionMap = Record<string, string>;

type Decision = {
  hasAnswer: boolean;
  answer?: string;
  nextUrl?: string;
  nextUrls?: string[];
};

const ROOT_URL = process.env.SOFTO_ROOT_URL || '';

type LinkInfo = { url: string; label: string };

function absolutizeUrl(baseUrl: string, href: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function extractLinks(html: string, baseUrl: string): LinkInfo[] {
  const links = new Map<string, string>();
  const regex = /<a\s+[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const href = (match[1] ?? '') as string;
    const labelRaw = (match[2] ?? '') as string;
    const label = htmlToText(String(labelRaw)).slice(0, 200);
    const abs = absolutizeUrl(baseUrl, href);
    if (abs.startsWith('http')) {
      if (!links.has(abs)) links.set(abs, label || abs);
    }
  }
  return Array.from(links.entries()).map(([url, label]) => ({ url, label }));
}

function htmlToText(html: string): string {
  // Lightweight HTML to text to keep tokens low; remove scripts/styles and tags
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, '');
  const withNewlines = withoutStyles
    .replace(/<\/(p|div|li|h[1-6]|br|tr)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t');
  const text = withNewlines.replace(/<[^>]+>/g, '');
  return text.replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function fetchHtml(url: string): Promise<{ html: string; text: string; links: LinkInfo[] }> {
  const { data } = await axios.get<string>(url, { responseType: 'text', timeout: 20000 });
  const html = String(data || '');
  const text = htmlToText(html);
  const links = extractLinks(html, url);
  return { html, text, links };
}

async function decide(question: string, pageText: string, links: LinkInfo[]): Promise<Decision> {
  const system = 'Jesteś agentem nawigującym po stronach firmy aby znaleźć krótką konkretną odpowiedź. Oceniaj minimalnie i wybieraj najlepsze linki. Zawsze zwracaj wyłącznie JSON.';
  const user = `Pytanie: ${question}
---
Treść strony (przycięta):\n${pageText.slice(0, 8000)}
---
Linki dostępne (${links.length}):\n${links.slice(0, 50).map(l => `- ${l.label} -> ${l.url}`).join('\n')}

Instrukcje:
1) Jeśli na podstawie Treści strony możesz udzielić jednoznacznej, bardzo krótkiej odpowiedzi (np. email, liczba, nazwa) – zwróć JSON: {"hasAnswer":true,"answer":"ODP"}
2) W przeciwnym razie wybierz do trzech najbardziej obiecujących linków z listy Linki dostępne, posortowanych od najlepszego. Wybieraj TYLKO spośród podanych linków. Preferuj odnośniki semantycznie pasujące do pytania (np. Kontakt, O nas, Portfolio, Aktualności itd.). Zwróć JSON: {"hasAnswer":false,"nextUrls":["URL1","URL2","URL3"]}
3) Zwróć wyłącznie czysty JSON (bez komentarza).`;

  const raw = await openAIClient.question(system, user, 'gpt-4o-mini');
  const match = raw.match(/\{[\s\S]*\}/);
  try {
    const parsed = match ? JSON.parse(match[0]) as Decision : { hasAnswer: false };
    return parsed;
  } catch {
    return { hasAnswer: false };
  }
}

async function getQuestions(): Promise<QuestionMap> {
  const file = await centralaClient.getFile('softo.json');
  const data = typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
  return data as QuestionMap;
}

function normalizeAnswer(a: string): string {
  return (a || '').trim();
}

async function answerOne(questionId: string, question: string): Promise<string> {
  const visited = new Set<string>();
  let frontier: string[] = [ROOT_URL];
  const maxSteps = 60;
  let steps = 0;

  while (frontier.length > 0 && steps < maxSteps) {
    steps += 1;
    const url = frontier.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const { text, links } = await fetchHtml(url);
      console.log(`[S04E03] Q${questionId} step ${steps} @ ${url}`);
      const decision = await decide(question, text, links);
      if (decision.hasAnswer && decision.answer) {
        return normalizeAnswer(decision.answer);
      }
      const candidates: string[] = [];
      if (decision.nextUrls && Array.isArray(decision.nextUrls)) {
        candidates.push(...decision.nextUrls);
      } else if (decision.nextUrl) {
        candidates.push(decision.nextUrl);
      }
      if (candidates.length > 0) {
        for (const c of candidates) {
          const next = absolutizeUrl(url, c);
          if (next.includes('softo.ag3nts.org') && !visited.has(next)) frontier.push(next);
        }
        continue;
      }
      // Fallback heuristic: push plausible links with softo domain only
      for (const l of links) {
        if (l.url.includes('softo.ag3nts.org') && !visited.has(l.url)) frontier.push(l.url);
      }
    } catch (e) {
      // Skip failing URL
    }
  }
  throw new Error(`Brak odpowiedzi dla pytania ${questionId}`);
}

async function run(): Promise<void> {
  const questions = await getQuestions();
  const answers: Record<string, string> = {};
  for (const id of Object.keys(questions).sort()) {
    const q = String(questions[id] ?? '');
    const a = await answerOne(id, q);
    answers[id] = a;
    console.log(`Q${id} -> ${a}`);
  }

  const res = await centralaClient.report('softo', answers);
  console.log(res.data);
}

run().catch((err) => {
  console.error('S04E03 error:', err);
  process.exitCode = 1;
});


