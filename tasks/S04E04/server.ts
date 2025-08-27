import 'dotenv/config';
import { parseInstructionToMoves } from './parser';
import { applyMoves } from './logic';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

type RequestBody = { instruction?: string };

const PORT = Number(process.env.PORT || 3000);

export const server = Bun.serve({
  port: PORT,
  fetch: async (req: Request) => {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/api/dron') {
      let body: RequestBody = {};
      try {
        body = (await req.json()) as RequestBody;
      } catch {
        body = {};
      }

      const instruction = (body.instruction ?? '').toString();
      try {
        const moves = await parseInstructionToMoves(instruction);
        const { point, description } = applyMoves(moves);
        console.log(JSON.stringify({ method: 'POST', path: '/api/dron', body, position: point, description }));
        return json({ description });
      } catch (e) {
        console.error('Error handling /api/dron:', e);
        return json({ description: 'znacznik mapy' });
      }
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return json({ status: 'ok' });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`Server running on http://localhost:${PORT}`);


