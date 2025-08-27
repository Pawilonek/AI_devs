import { openAIClient } from '../../services/openai/openai';

export type Move =
  | { type: 'UP'; steps: number | 'MAX' }
  | { type: 'DOWN'; steps: number | 'MAX' }
  | { type: 'LEFT'; steps: number | 'MAX' }
  | { type: 'RIGHT'; steps: number | 'MAX' };

function normalize(raw: string): string {
  return raw.trim();
}

export async function parseInstructionToMoves(instructionRaw: string | undefined | null): Promise<Move[]> {
  const instruction = typeof instructionRaw === 'string' ? normalize(instructionRaw) : '';
  if (!instruction) return [];

  const system = `Jesteś parserem komend ruchu drona na siatce 4x4.
Zwróć wyłącznie poprawny JSON array bez komentarzy i tekstu pobocznego.
Każdy element ma postać {"type":"UP|DOWN|LEFT|RIGHT","steps": 1..10 lub "MAX"}.
Zasady (polski):
- Synonimy kierunków: prawo/w prawo/na prawo/wschód -> RIGHT; lewo/w lewo/na lewo/zachód -> LEFT; dół/w dół/na dół/południe -> DOWN; góra/w górę/na górę/północ -> UP
- "na sam <kierunek>" -> steps = "MAX"
- Jeżeli liczba kroków nie podana -> steps = 1
- Kolejność zgodna z instrukcją
Nie dodawaj innych pól.`;

  const user = `Instrukcja: ${instruction}\nZwróć tylko JSON: [{"type":"RIGHT","steps":1}, ...]`;

  try {
    const raw = await openAIClient.question(system, user, 'gpt-4o-mini');
    const s = raw ?? '';
    const start = s.indexOf('[');
    const end = s.lastIndexOf(']');
    const json = start >= 0 && end >= 0 ? s.slice(start, end + 1) : '[]';
    const parsed = JSON.parse(json) as Array<{ type: string; steps?: number | 'MAX' }>;
    const moves: Move[] = parsed
      .map((m) => {
        const type = (m?.type || '').toUpperCase();
        let steps: number | 'MAX' = (m as any)?.steps as any;
        if (steps === undefined || steps === null || (steps as any) === '') steps = 1;
        if (steps !== 'MAX') {
          const n = Number(steps);
          steps = Number.isFinite(n) ? Math.max(1, Math.min(10, n)) : 1;
        }
        return { type, steps } as Move;
      })
      .filter((m) =>
        m && (m.type === 'UP' || m.type === 'DOWN' || m.type === 'LEFT' || m.type === 'RIGHT') &&
        (m.steps === 'MAX' || Number.isFinite(m.steps as number))
      );
    return moves;
  } catch (e) {
    console.error('LLM parse failed, returning empty moves:', e);
    return [];
  }
}


