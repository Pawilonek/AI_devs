import 'dotenv/config';
import { centralaClient } from '../../clients/centrala/client';
import { openAIClient } from '../../services/openai/openai';

type ReportResponse = {
  code?: string | number;
  message?: string;
  error?: string;
  status?: string;
  result?: unknown;
  data?: unknown;
};

type ImageRef = {
  url: string;
  filename: string;
};

type VisionDecision = {
  operation: 'REPAIR' | 'DARKEN' | 'BRIGHTEN' | 'NONE';
  confidence: number;
  reason: string;
};

const IMAGE_NAME_REGEX = /[A-Za-z0-9_\-]+\.(?:png|jpg|jpeg|gif|webp)/gi;
const URL_REGEX = /https?:\/\/[^\s)"']+/gi;

function trimTrailingPunctuation(input: string): string {
  let out = String(input || '').trim();
  const trailing = new Set<string>(['.', ',', ';', ':', ')', ']', '"', "'", '…']);
  while (out.length > 0 && trailing.has(out[out.length - 1] as string)) {
    out = out.slice(0, -1);
  }
  return out;
}

function basenameFromUrl(url: string): string {
  try {
    const u = new URL(trimTrailingPunctuation(url));
    const p = u.pathname.split('/')
      .filter(Boolean)
      .pop() || url;
    return decodeURIComponent(trimTrailingPunctuation(p));
  } catch {
    const parts = trimTrailingPunctuation(url).split('/');
    return parts[parts.length - 1] || url;
  }
}

function toSmallVariant(url: string): string {
  try {
    const u = new URL(trimTrailingPunctuation(url));
    const name = basenameFromUrl(u.href);
    const smallName = toSmallFilename(name);
    const prefix = u.href.slice(0, u.href.lastIndexOf(name));
    return prefix + encodeURIComponent(smallName);
  } catch {
    const cleaned = trimTrailingPunctuation(url);
    const name = basenameFromUrl(cleaned);
    return cleaned.replace(name, toSmallFilename(name));
  }
}

function toSmallFilename(filename: string): string {
  const clean = trimTrailingPunctuation(filename);
  const idx = clean.lastIndexOf('.');
  if (idx === -1) return clean + '-small';
  const base = clean.slice(0, idx);
  const ext = clean.slice(idx);
  return base + '-small' + ext;
}

function fromSmallFilename(filename: string): string {
  const clean = trimTrailingPunctuation(filename);
  const idx = clean.lastIndexOf('.');
  if (idx === -1) return clean.replace(/-small$/i, '');
  const base = clean.slice(0, idx).replace(/-small$/i, '');
  const ext = clean.slice(idx);
  return base + ext;
}

function fromSmallUrl(url: string): string {
  try {
    const u = new URL(trimTrailingPunctuation(url));
    const name = basenameFromUrl(u.href);
    const normal = fromSmallFilename(name);
    const prefix = u.href.slice(0, u.href.lastIndexOf(name));
    return prefix + encodeURIComponent(normal);
  } catch {
    const cleaned = trimTrailingPunctuation(url);
    const name = basenameFromUrl(cleaned);
    return cleaned.replace(name, fromSmallFilename(name));
  }
}

function extractImagesFromText(text: string): ImageRef[] {
  const urls = Array.from(text.matchAll(URL_REGEX)).map((m) => trimTrailingPunctuation(m[0]));
  const unique: ImageRef[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const name = basenameFromUrl(url);
    if (!name.match(IMAGE_NAME_REGEX)) continue;
    const key = url + '|' + name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ url, filename: trimTrailingPunctuation(name) });
  }
  // Fallback: if no URLs, try to extract just filenames
  if (unique.length === 0) {
    const names = Array.from(text.matchAll(IMAGE_NAME_REGEX)).map((m) => trimTrailingPunctuation(m[0]));
    for (const name of names) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ url: name, filename: trimTrailingPunctuation(name) });
    }
  }
  return unique;
}

function buildImageUrlFromFilename(filename: string): string | null {
  const baseUrl = process.env.CENTRALA_URL || '';
  const apikey = process.env.CENTRALA_SECRET || '';
  if (!baseUrl || !apikey) return null;
  const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmed}/data/${apikey}/${encodeURIComponent(filename)}`;
}

async function startConversation(): Promise<string> {
  const res = await centralaClient.report('photos', 'START');
  const data = res?.data as ReportResponse | string | undefined;
  if (!data) throw new Error('Brak odpowiedzi z centrali po START');
  const message = typeof data === 'string' ? data : (data.message || JSON.stringify(data));
  return message || '';
}

function parseNewFilename(reply: string, preferNot: string | null = null): string | null {
  const matches = Array.from(reply.matchAll(IMAGE_NAME_REGEX)).map((m) => trimTrailingPunctuation(m[0]));
  if (matches.length === 0) return null;
  if (preferNot) {
    // Return first different than preferNot if possible
    const diff = matches.find((n) => trimTrailingPunctuation(n).toLowerCase() !== trimTrailingPunctuation(preferNot).toLowerCase());
    if (diff) return diff;
  }
  return (matches[matches.length - 1] ?? matches[0] ?? null);
}

async function decideOperation(image: ImageRef): Promise<VisionDecision> {
  const system = 'Jesteś ekspertem od jakości zdjęć. Oceń jedno zdjęcie i wybierz najlepszą pojedynczą operację poprawy: REPAIR (szumy/glitche), DARKEN (zbyt jasne), BRIGHTEN (zbyt ciemne), albo NONE. Zwróć JSON z polami operation, confidence (0..1), reason. Bądź rzeczowy.';
  const smallUrl = image.url.startsWith('http') ? toSmallVariant(image.url) : image.url;
  let raw: string;
  try {
    const user = [
      { type: 'text', text: 'Przeanalizuj zdjęcie i zdecyduj jedną operację jakościową. Zwróć wyłącznie poprawny JSON.' },
      { type: 'image_url', image_url: { url: smallUrl } },
    ] as any;
    raw = await openAIClient.vision(system, user);
  } catch {
    const fallbackUrl = image.url.startsWith('http') ? fromSmallUrl(image.url) : image.url;
    const user2 = [
      { type: 'text', text: 'Przeanalizuj zdjęcie i zdecyduj jedną operację jakościową. Zwróć wyłącznie poprawny JSON.' },
      { type: 'image_url', image_url: { url: fallbackUrl } },
    ] as any;
    raw = await openAIClient.vision(system, user2);
  }
  try {
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    const sliced = jsonStart !== -1 && jsonEnd !== -1 ? raw.slice(jsonStart, jsonEnd + 1) : raw;
    const parsed = JSON.parse(sliced) as VisionDecision;
    if (!parsed || !parsed.operation) throw new Error('Brak pola operation');
    if (!['REPAIR', 'DARKEN', 'BRIGHTEN', 'NONE'].includes(parsed.operation)) throw new Error('Zła operacja');
    return {
      operation: parsed.operation,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      reason: String(parsed.reason || ''),
    };
  } catch {
    // Fallback regex-based heuristic if parsing fails
    const up = raw.toUpperCase();
    if (up.includes('GLITCH') || up.includes('REPAIR')) return { operation: 'REPAIR', confidence: 0.5, reason: 'Heurystyka: tekst sugeruje naprawę' };
    if (up.includes('TOO BRIGHT') || up.includes('ZBYT JASN') || up.includes('DARKEN')) return { operation: 'DARKEN', confidence: 0.5, reason: 'Heurystyka: zbyt jasne' };
    if (up.includes('TOO DARK') || up.includes('ZBYT CIEMN') || up.includes('BRIGHTEN')) return { operation: 'BRIGHTEN', confidence: 0.5, reason: 'Heurystyka: zbyt ciemne' };
    return { operation: 'NONE', confidence: 0.3, reason: 'Niepewne — brak sugestii' };
  }
}

async function processSingleImage(original: ImageRef): Promise<ImageRef | null> {
  let current = { ...original } as ImageRef;
  const maxSteps = 3;
  for (let step = 0; step < maxSteps; step++) {
    const decision = await decideOperation(current);
    if (decision.operation === 'NONE') return current;
    const command = `${decision.operation} ${current.filename}`;
    const reply = await centralaClient.report('photos', command);
    const msg: string = typeof reply?.data === 'string' ? reply.data : (reply?.data?.message || JSON.stringify(reply?.data));

    // Try to extract new filename
    const nextName = parseNewFilename(msg, current.filename) || current.filename;
    if (nextName.toLowerCase() === current.filename.toLowerCase()) {
      // No new file produced; stop to avoid loop
      return current;
    }

    const nextUrl = current.url.startsWith('http')
      ? current.url.replace(/[^/]+$/u, encodeURIComponent(nextName))
      : (buildImageUrlFromFilename(nextName) || current.url);
    current = { url: nextUrl, filename: nextName };
  }
  return current;
}

async function generateRysopis(images: ImageRef[]): Promise<string> {
  const system = [
    'Jesteś ekspertem w analizie zdjęć i tworzeniu rysopisów.',
    'Zdjęcia są fikcyjne i służą do testów. Twoim zadaniem jest obiektywny, szczegółowy opis wyglądu kobiety na zdjęciach.',
    'Skup się na powtarzających się cechach (włosy, oczy, rysy twarzy, znaki szczególne, okulary/biżuteria, ubiór).',
    'Unikaj prób identyfikacji osoby po nazwisku. Podaj neutralny opis po polsku.',
    'W opisie MUSI znaleźć się jednoznaczna informacja o kolorze włosów oraz precyzyjne umiejscowienie tatuażu (np. lewy/prawy nadgarstek, ramię, łopatka itp.).',
  ].join(' ');
  const userContent: any[] = [
    { type: 'text', text: 'Na podstawie zestawu zdjęć sporządź spójny, szczegółowy rysopis kobiety (Barbara). Skup się na cechach powtarzalnych między zdjęciami. Odpowiedz po polsku, pełnymi zdaniami. Wyraźnie podaj: kolor włosów oraz dokładne miejsce tatuażu.' },
  ];
  for (const img of images) {
    const url = img.url.startsWith('http') ? fromSmallUrl(img.url) : (buildImageUrlFromFilename(img.filename) || img.url);
    userContent.push({ type: 'image_url', image_url: { url } });
  }
  const r = await openAIClient.vision(system, userContent as any);
  return r.trim();
}

async function run(): Promise<void> {
  try {
    if (!process.env.CENTRALA_URL || !process.env.CENTRALA_SECRET) {
      console.warn('Brak zmiennych CENTRALA_URL lub CENTRALA_SECRET – połączenie z centralą może się nie powieść.');
    }
    if (!process.env.OPENAI_API_KEY) {
      console.warn('Brak OPENAI_API_KEY – analiza obrazów nie zadziała.');
    }

    console.log('Inicjuję rozmowę (START)...');
    const startMsg = await startConversation();
    console.log('Odpowiedź START:', startMsg);

    const initial = extractImagesFromText(startMsg);
    if (initial.length === 0) {
      throw new Error('Nie udało się wyodrębnić zdjęć z odpowiedzi START.');
    }

    // Normalize to full URLs when possible
    const images: ImageRef[] = initial.map((img) => {
      if (img.url.startsWith('http')) return img;
      const built = buildImageUrlFromFilename(img.filename);
      return { url: built || img.url, filename: img.filename };
    });

    console.log('Znalezione zdjęcia:', images.map((i) => i.filename).join(', '));

    const processed: ImageRef[] = [];
    for (const img of images) {
      console.log(`\nPrzetwarzam: ${img.filename}`);
      try {
        const out = await processSingleImage(img);
        if (out) {
          processed.push(out);
          console.log('Wersja końcowa:', out.filename, out.url);
        } else {
          console.log('Pomijam zdjęcie – nie udało się poprawić.');
        }
      } catch (e) {
        console.warn('Błąd przetwarzania zdjęcia:', img.filename, e);
      }
    }

    if (processed.length === 0) {
      throw new Error('Brak przetworzonych zdjęć do rysopisu.');
    }

    console.log('\nGeneruję rysopis na podstawie przetworzonych zdjęć...');
    const rysopis = await generateRysopis(processed);
    console.log('\nRysopis (podgląd):\n', rysopis);

    console.log('\nWysyłam rysopis do centrali...');
    const finalRes = await centralaClient.report('photos', rysopis);
    console.log('Odpowiedź centrali:', finalRes?.data);
  } catch (err) {
    console.error('Błąd w zadaniu S04E01 (photos):', err);
    process.exitCode = 1;
  }
}

run().catch(console.error);


