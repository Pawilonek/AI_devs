import 'dotenv/config';
import axios from 'axios';
import { centralaClient } from '../../clients/centrala/client';

type ApiReply = unknown;

const PEOPLE_URL = 'https://c3ntrala.ag3nts.org/people';
const PLACES_URL = 'https://c3ntrala.ag3nts.org/places';
const NOTE_URL = 'https://c3ntrala.ag3nts.org/dane/barbara.txt';

function removeDiacritics(input: string): string {
  // Normalize and strip combining marks; handle Polish-specific uppercase mapping
  const normalized = input.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  return normalized
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toUpperCase();
}

function normalizePersonName(raw: string): string {
  let s = removeDiacritics(raw.trim());
  // Heuristics to convert common Polish inflections to nominative
  // Handle specific known bases first
  if (s.startsWith('ALEKSANDR')) return 'ALEKSANDER';
  if (s.startsWith('BARBAR')) return 'BARBARA';
  if (s.startsWith('RAFAL')) return 'RAFAL';

  // Generic masculine endings
  s = s.replace(/(OWI|OW|EM|IE|U|A)$/u, '');
  // Generic feminine endings to BARBARA-like forms
  s = s.replace(/(E|Y|A)$/u, (m) => (m === 'A' ? 'A' : ''));
  // Avoid empty
  if (s.length < 3) s = removeDiacritics(raw).toUpperCase();
  return s;
}

function normalizeCity(raw: string): string {
  return removeDiacritics(raw.trim()).toUpperCase();
}

function extractCandidatesFromText(text: string): { names: Set<string>; cities: Set<string> } {
  const names = new Set<string>();
  const cities = new Set<string>();

  // Split into tokens and simple sentence-based context to guess cities
  const lines = text.split(/\n+/);
  for (const line of lines) {
    const rawTokens = line.match(/[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ]{2,}/g) || [];
    for (const token of rawTokens) {
      const up = removeDiacritics(token);
      // Heuristics: tokens written originally as ALL CAPS in the note are more likely to be cities
      const wasAllCaps = token === token.toUpperCase();
      if (wasAllCaps) {
        cities.add(normalizeCity(token));
      }
      // Add as potential person as well
      names.add(normalizePersonName(token));
    }
  }

  // Strongly infer cities explicitly mentioned in the note (normalize and search substrings)
  const normalizedNote = removeDiacritics(text).toUpperCase();
  if (normalizedNote.includes('KRAKOW')) cities.add('KRAKOW');
  if (normalizedNote.includes('WARSZAW')) cities.add('WARSZAWA');

  // Seed with core names we expect from the brief, just in case extraction missed casing
  names.add('BARBARA');
  names.add('ALEKSANDER');
  names.add('RAFAL');

  return { names, cities };
}

async function fetchNote(): Promise<string> {
  const { data } = await axios.get<string>(NOTE_URL, { responseType: 'text' });
  return String(data || '');
}

async function postApi(url: string, query: string): Promise<ApiReply> {
  const apikey = process.env.CENTRALA_SECRET || '';
  const payload = { apikey, query };
  const { data } = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  return data as ApiReply;
}

function extractUpperTokensFromApi(data: ApiReply): string[] {
  // Be defensive: stringify and extract UPPERCASE ASCII tokens length >= 3
  try {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    const tokens = text.match(/\b[A-Z]{3,}\b/g) || [];
    // De-duplicate preserve order
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tokens) {
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function run(): Promise<void> {
  try {
    if (!process.env.CENTRALA_SECRET) {
      console.warn('Brak CENTRALA_SECRET w środowisku – żądania do API mogą się nie powieść.');
    }

    console.log('Pobieram notatkę o Barbarze...');
    const note = await fetchNote();
    const { names: initialNames, cities: initialCities } = extractCandidatesFromText(note);

    const queuePersons: string[] = Array.from(initialNames);
    const queueCities: string[] = Array.from(initialCities);
    const visitedPersons = new Set<string>();
    const visitedCities = new Set<string>();

    const placesByPerson = new Map<string, Set<string>>();
    const peopleByPlace = new Map<string, Set<string>>();

    const initialCitiesSnapshot = new Set(initialCities);

    let foundCityWithBarbara: string | null = null;

    const maxIterations = 300;
    let iterations = 0;

    console.log('Start kolejki:');
    console.log('Osoby:', queuePersons);
    console.log('Miasta:', queueCities);

    while (iterations < maxIterations && (queuePersons.length > 0 || queueCities.length > 0)) {
      iterations += 1;

      if (queuePersons.length > 0) {
        const raw = queuePersons.shift()!;
        const person = normalizePersonName(raw);
        if (visitedPersons.has(person)) {
          // continue to cities in same iteration
        } else {
          visitedPersons.add(person);
          console.log(`\n[PEOPLE] Zapytanie dla osoby: ${person}`);
          try {
            const res = await postApi(PEOPLE_URL, person);
            console.log('[PEOPLE] Odpowiedź:', JSON.stringify(res));
            const tokens = extractUpperTokensFromApi(res);
            for (const token of tokens) {
              const city = normalizeCity(token);
              if (!visitedCities.has(city) && !queueCities.includes(city)) {
                queueCities.push(city);
              }
              if (!placesByPerson.has(person)) placesByPerson.set(person, new Set());
              placesByPerson.get(person)!.add(city);
            }
          } catch (e) {
            console.warn(`[PEOPLE] Błąd zapytania dla ${person}:`, e);
          }
        }
      }

      if (queueCities.length > 0) {
        const raw = queueCities.shift()!;
        const city = normalizeCity(raw);
        if (visitedCities.has(city)) {
          continue;
        }
        visitedCities.add(city);
        console.log(`\n[PLACES] Zapytanie dla miasta: ${city}`);
        try {
          const res = await postApi(PLACES_URL, city);
          console.log('[PLACES] Odpowiedź:', JSON.stringify(res));
          const tokens = extractUpperTokensFromApi(res);
          for (const token of tokens) {
          const person = normalizePersonName(token);
          if (person.length >= 4 && !visitedPersons.has(person) && !queuePersons.includes(person)) {
              queuePersons.push(person);
            }
            if (!peopleByPlace.has(city)) peopleByPlace.set(city, new Set());
            peopleByPlace.get(city)!.add(person);
          }

          // Check for BARBARA presence at this city
          const peopleHere = peopleByPlace.get(city) || new Set<string>();
          if (peopleHere.has('BARBARA')) {
            if (!initialCitiesSnapshot.has(city) && !foundCityWithBarbara) {
              foundCityWithBarbara = city;
              console.log(`[FOUND] Potencjalne aktualne miejsce Barbary: ${city}`);
              // Do not break; keep building graph for insights
            }
          }
        } catch (e) {
          console.warn(`[PLACES] Błąd zapytania dla ${city}:`, e);
        }
      }
    }

    // Derive insights
    let coworker: string | null = null;
    const citiesWithBoth: string[] = [];
    for (const [city, people] of peopleByPlace.entries()) {
      if (people.has('ALEKSANDER') && people.has('BARBARA')) {
        citiesWithBoth.push(city);
        for (const p of people) {
          if (p !== 'ALEKSANDER' && p !== 'BARBARA') {
            coworker = p;
            break;
          }
        }
        if (coworker) break;
      }
    }

    const metWithRafal = new Set<string>();
    for (const [city, people] of peopleByPlace.entries()) {
      if (people.has('RAFAL')) {
        for (const p of people) if (p !== 'RAFAL') metWithRafal.add(p);
      }
    }

    console.log('\n--- Podsumowanie ---');
    console.log('Znalezione miasta z BARBARA (nowe):', foundCityWithBarbara || '(brak)');
    console.log('Miasta z jednoczesną obecnością ALEKSANDER i BARBARA:', citiesWithBoth);
    console.log('Współpracownik Aleksandra i Barbary (hipoteza):', coworker || '(nieustalone)');
    console.log('Osoby widziane z Rafałem:', Array.from(metWithRafal));

    if (!foundCityWithBarbara) {
      console.warn('Nie udało się jednoznacznie ustalić nowego miasta Barbary.');
    } else {
      console.log('\nWysyłam odpowiedź do centrali...');
      try {
        const flag = await centralaClient.report('loop', foundCityWithBarbara);
        console.log('Odpowiedź centrali:', flag.data);
      } catch (e) {
        console.warn('Raport do centrali nie został zaakceptowany dla miasta:', foundCityWithBarbara, e);
      }
    }
  } catch (err) {
    console.error('Błąd w zadaniu S03E04:', err);
    process.exitCode = 1;
  }
}

run().catch(console.error);


