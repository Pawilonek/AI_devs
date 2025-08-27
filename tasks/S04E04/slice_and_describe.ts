import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { openAIClient } from '../../services/openai/openai';

const INPUT_IMAGE = path.join(process.cwd(), 'tasks', 'S04E04', 'mapa_s04e04.png');
const OUTPUT_DIR = path.join(process.cwd(), 'tasks', 'S04E04', 'tiles');
const OUTPUT_JSON = path.join(process.cwd(), 'tasks', 'S04E04', 'tiles_descriptions.json');

type TileInfo = {
  row: number;
  col: number;
  file: string;
  shortDescription?: string;
  longDescription?: string;
};

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function sliceImageToGrid4x4(inputPath: string, outputDir: string): Promise<TileInfo[]> {
  ensureDir(outputDir);
  const image = sharp(inputPath);
  const meta = await image.metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read image dimensions');
  }
  const width = meta.width;
  const height = meta.height;
  const baseTileW = Math.floor(width / 4);
  const baseTileH = Math.floor(height / 4);

  const tiles: TileInfo[] = [];

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const left = col * baseTileW;
      const top = row * baseTileH;
      const tileW = col === 3 ? width - left : baseTileW;
      const tileH = row === 3 ? height - top : baseTileH;
      const filename = `tile_r${row}_c${col}.png`;
      const outPath = path.join(outputDir, filename);
      await image
        .clone()
        .extract({ left, top, width: tileW, height: tileH })
        .png()
        .toFile(outPath);

      tiles.push({ row, col, file: outPath });
    }
  }
  return tiles;
}

function toDataUrl(buffer: Buffer, mime = 'image/png'): string {
  const b64 = buffer.toString('base64');
  return `data:${mime};base64,${b64}`;
}

async function describeTileWithVision(tilePath: string): Promise<{ short: string; long: string }> {
  const buffer = await fs.promises.readFile(tilePath);
  const dataUrl = toDataUrl(buffer);

  const systemShort = `Jesteś asystentem rozpoznającym zawartość kafelków mapy.
Odpowiadaj maksymalnie dwoma słowami po polsku, bez kropek i znaków interpunkcyjnych.
Skup się na najważniejszym obiekcie/terenie widocznym na kafelku.`;

  const systemLong = `Jesteś asystentem opisującym zawartość kafelków mapy.
Zwróć krótki opis po polsku (maks. 10–12 słów) najważniejszych elementów terenu widocznych na kafelku.`;

  // Types in SDK for vision content parts vary; use any to pass structured parts.
  const userPartsShort: any = [
    { type: 'text', text: 'Zidentyfikuj co przedstawia kafelek. Zwróć tylko 1–2 słowa po polsku.' },
    { type: 'image_url', image_url: { url: dataUrl } },
  ];
  const userPartsLong: any = [
    { type: 'text', text: 'Opisz krótko co przedstawia kafelek. Po polsku, 10–12 słów.' },
    { type: 'image_url', image_url: { url: dataUrl } },
  ];

  let short = '';
  let long = '';
  try {
    short = (await openAIClient.vision(systemShort, userPartsShort)).trim();
  } catch (e) {
    console.error('Vision short desc failed for', tilePath, e);
    short = 'nieznane';
  }

  try {
    long = (await openAIClient.vision(systemLong, userPartsLong)).trim();
  } catch (e) {
    console.error('Vision long desc failed for', tilePath, e);
    long = short;
  }

  // Normalize to max two words for short
  short = short
    .replace(/[.,;:!?'"\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 2)
    .join(' ')
    .toLowerCase();

  return { short, long };
}

async function main() {
  if (!fs.existsSync(INPUT_IMAGE)) {
    console.error('Input image not found:', INPUT_IMAGE);
    process.exit(1);
  }

  console.log('Slicing image into 4x4 tiles...');
  const tiles = await sliceImageToGrid4x4(INPUT_IMAGE, OUTPUT_DIR);
  console.log(`Saved ${tiles.length} tiles to`, OUTPUT_DIR);

  const results: TileInfo[] = [];
  for (const tile of tiles) {
    console.log(`Describing r${tile.row} c${tile.col}...`);
    const { short, long } = await describeTileWithVision(tile.file);
    results.push({ ...tile, shortDescription: short, longDescription: long });
  }

  await fs.promises.writeFile(OUTPUT_JSON, JSON.stringify(results, null, 2), 'utf-8');
  console.log('Descriptions saved to', OUTPUT_JSON);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


