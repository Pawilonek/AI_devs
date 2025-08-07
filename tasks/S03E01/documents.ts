import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { centralaClient } from '../../clients/centrala/client';

type Facts = {
  sectors: Record<string, string[]>;
  persons: Record<string, { aliases: string[]; keywords: string[] }>; // canonical full name → data
};

function getTaskDir(): string {
  return new URL('.', import.meta.url).pathname;
}

async function readFacts(): Promise<Facts> {
  const baseDir = path.join(getTaskDir(), 'pliki_z_fabryki');
  const factsDir = path.join(baseDir, 'facts');

  const facts: Facts = {
    sectors: {
      A: ['montaż', 'robot', 'robot wojskowy', 'kontrola jakości', 'monitoring', 'biometria'],
      B: ['ogniwo bateryjne', 'badania', 'rozwój', 'laboratorium', 'komora', 'bezpieczeństwo'],
      C: ['test broni', 'osłona przeciwodłamkowa', 'system monitorujący', 'tajność'],
    },
    persons: {
      'Aleksander Ragowski': {
        aliases: ['Aleksander Ragowski', 'Aleksander Ragorski'],
        keywords: ['nauczyciel', 'język angielski', 'ruch oporu', 'programista', 'Java', 'aresztowanie', 'ucieczka', 'poszukiwanie'],
      },
      'Barbara Zawadzka': {
        aliases: ['Barbara Zawadzka'],
        keywords: ['frontend', 'programistka', 'JavaScript', 'Python', 'sztuczna inteligencja', 'baza wektorowa', 'ruch oporu', 'krav maga', 'broń palna', 'koktajl Mołotowa', 'Kraków', 'ulica Bracka', 'zakłócenie komunikacji'],
      },
      Azazel: {
        aliases: ['Azazel'],
        keywords: ['podróż w czasie', 'teleportacja', 'system operacyjny', 'robot', 'fabryka', 'technologia przyszłości', 'Zygfryd'],
      },
      'Rafał Bomba': {
        aliases: ['Rafał Bomba', 'Musk'],
        keywords: ['laborant', 'eksperyment', 'podróż w czasie', 'sztuczna inteligencja', 'nanotechnologia', 'zaburzenie psychiczne', 'ośrodek'],
      },
      'Adam Gospodarczyk': {
        aliases: ['Adam Gospodarczyk'],
        keywords: ['rekrutacja', 'programowanie', 'szkolenie', 'agent', 'hakowanie', 'bypass zabezpieczeń AI'],
      },
      Zygfryd: {
        aliases: ['Zygfryd'],
        keywords: ['mocodawca', 'władza robotów'],
      },
    },
  };

  // Best-effort: load files to keep future extensibility, even jeśli nie parsujemy automatycznie w 100%
  try {
    const factFiles = await fs.readdir(factsDir);
    await Promise.all(
      factFiles
        .filter((f) => f.endsWith('.txt'))
        .map(async (f) => {
          await fs.readFile(path.join(factsDir, f), 'utf-8');
          // Miejsce na ewentualny parsing i wzbogacanie facts w przyszłości
        })
    );
  } catch {
    // ignore, fallback na wbudowaną wiedzę
  }

  return facts;
}

function extractSectorFromFilename(filename: string): { sectorFull?: string; sectorLetter?: string } {
  const match = filename.match(/sektor[_-]([A-Z])(\d+)/);
  if (!match) return {};
  const [, letter, num] = match;
  return { sectorFull: `${letter}${num}`, sectorLetter: letter };
}

function detectPersons(text: string, facts: Facts): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const [canonical, data] of Object.entries(facts.persons)) {
    if (data.aliases.some((alias) => lower.includes(alias.toLowerCase()))) {
      found.push(canonical);
    }
  }
  return found;
}

function buildKeywords(reportText: string, filename: string, facts: Facts): string[] {
  const keywords = new Set<string>();

  // Always use filename sector info
  const { sectorFull, sectorLetter } = extractSectorFromFilename(filename);
  if (sectorFull) keywords.add(`sektor ${sectorFull}`);
  if (sectorLetter) keywords.add(`sektor ${sectorLetter}`);

  // Generic location/context
  keywords.add('fabryka');
  keywords.add('patrol');

  const text = reportText;
  const lower = text.toLowerCase();

  // Heurystyki zdarzeń
  if (lower.includes('ultradźwięk')) keywords.add('ultradźwięk');
  if (lower.includes('nadajnik')) keywords.add('nadajnik');
  if (lower.includes('odcisk') || lower.includes('daktyloskop')) {
    keywords.add('odcisk palca');
    keywords.add('analiza daktyloskopijna');
  }
  if (lower.includes('zwierzyn') || lower.includes('wildlife') || lower.includes('dzika fauna')) {
    keywords.add('zwierzęta');
    keywords.add('fałszywy alarm');
  }
  if (lower.includes('jednostk') && lower.includes('organicz')) keywords.add('jednostka organiczna');
  if (lower.includes('biometrycz')) keywords.add('skan biometryczny');
  if (lower.includes('dział śledcz')) keywords.add('dział śledczy');
  if (lower.includes('bez anomalii') || lower.includes('brak anomalii')) keywords.add('brak anomalii');
  if (lower.includes('brak wykrycia')) keywords.add('brak wykrycia');
  if (lower.includes('brak ruchu')) keywords.add('brak ruchu');
  if (lower.includes('cisza') || lower.includes('spokój')) {
    keywords.add('cisza');
    keywords.add('spokój');
  }
  if (lower.includes('peryferi')) keywords.add('peryferia');
  if (lower.includes('skrzydł') && lower.includes('północ')) {
    keywords.add('skrzydło północne');
  }

  // Wzbogacenie o fakty sektorowe
  if (sectorLetter && facts.sectors[sectorLetter]) {
    for (const k of facts.sectors[sectorLetter]) keywords.add(k);
  }

  // Osoby i ich fakty
  const persons = detectPersons(text, facts);
  for (const person of persons) {
    keywords.add(person);
    const personData = facts.persons[person];
    if (personData) {
      for (const k of personData.keywords) keywords.add(k);
    }
  }

  return Array.from(keywords);
}

async function loadReports(): Promise<Array<{ filename: string; content: string }>> {
  const baseDir = path.join(getTaskDir(), 'pliki_z_fabryki');
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const reportFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.txt'))
    .map((e) => e.name)
    // Prefer only 10 first numbered report txts
    .filter((name) => /report-\d+-sektor_/i.test(name))
    .sort()
    .slice(0, 10);

  const reports = await Promise.all(
    reportFiles.map(async (name) => ({
      filename: name,
      content: await fs.readFile(path.join(baseDir, name), 'utf-8'),
    }))
  );

  return reports;
}

async function run(): Promise<void> {
  const facts = await readFacts();
  const reports = await loadReports();

  const answer: Record<string, string> = {};
  for (const report of reports) {
    const keys = buildKeywords(report.content, report.filename, facts);
    // Format: comma-separated, no spaces
    answer[report.filename] = keys.join(',');
  }

  const payload = {
    task: 'dokumenty',
    apikey: process.env.CENTRALA_SECRET || '',
    answer,
  };

  if (!process.env.CENTRALA_URL || !process.env.CENTRALA_SECRET) {
    console.warn('Uwaga: Brak CENTRALA_URL lub CENTRALA_SECRET w środowisku. Wysyłka może się nie powieść.');
  }

  console.log('Przygotowany JSON do wysyłki:\n', JSON.stringify(payload, null, 2));

  const flag = await centralaClient.report('dokumenty', answer);
  console.log('Odpowiedź centrali:', flag.data);
}

run().catch((err) => {
  console.error('Błąd podczas wykonywania zadania dokumenty:', err);
  process.exit(1);
});
