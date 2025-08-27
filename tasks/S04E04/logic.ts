import { grid } from './map';
import type { Move } from './parser';

export type Position = { row: number; col: number };

const NUM_ROWS = 4;
const NUM_COLS = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function applyMoves(moves: Move[], start: Position = { row: 0, col: 0 }): { point: Position; description: string } {
  let pos: Position = { ...start };

  for (const move of moves) {
    switch (move.type) {
      case 'UP': {
        if (move.steps === 'MAX') pos.row = 0; else pos.row = clamp(pos.row - move.steps, 0, NUM_ROWS - 1);
        break;
      }
      case 'DOWN': {
        if (move.steps === 'MAX') pos.row = NUM_ROWS - 1; else pos.row = clamp(pos.row + move.steps, 0, NUM_ROWS - 1);
        break;
      }
      case 'LEFT': {
        if (move.steps === 'MAX') pos.col = 0; else pos.col = clamp(pos.col - move.steps, 0, NUM_COLS - 1);
        break;
      }
      case 'RIGHT': {
        if (move.steps === 'MAX') pos.col = NUM_COLS - 1; else pos.col = clamp(pos.col + move.steps, 0, NUM_COLS - 1);
        break;
      }
    }
  }

  const r = clamp(pos.row, 0, NUM_ROWS - 1);
  const c = clamp(pos.col, 0, NUM_COLS - 1);
  const description = typeof grid[r]?.[c] === 'string' && grid[r]?.[c] ? (grid[r]![c] as string) : 'nieznane';
  return { point: { row: r, col: c }, description };
}



