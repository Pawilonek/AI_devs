import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { spawnSync } from 'child_process';

async function getLastPageNumber(pdfPath: string): Promise<number> {
  const absPdfPath = path.resolve(process.cwd(), pdfPath);
  const data = new Uint8Array(fs.readFileSync(absPdfPath)).buffer;
  const loadingTask = (pdfjsLib as any).getDocument({ data, disableWorker: true, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  return pdf.numPages;
}

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function havePdftoppm(): boolean {
  try {
    const res = spawnSync('pdftoppm', ['-v']);
    return res.status === 0 || res.status === 1; // many versions exit 1 on -v but still exist
  } catch {
    return false;
  }
}

async function renderLastPageToPng(pdfPath: string) {
  const absPdfPath = path.resolve(process.cwd(), pdfPath);
  if (!fs.existsSync(absPdfPath)) {
    throw new Error(`Nie znaleziono pliku: ${absPdfPath}`);
  }

  const lastPage = await getLastPageNumber(absPdfPath);

  const contextDir = path.resolve(process.cwd(), 'tasks/S04E05/context');
  ensureDir(contextDir);

  const baseName = path.basename(absPdfPath, path.extname(absPdfPath));
  const finalOutPath = path.resolve(contextDir, `${baseName}_page${String(lastPage).padStart(2, '0')}.png`);

  if (!havePdftoppm()) {
    throw new Error(
      "Nie znaleziono narzędzia 'pdftoppm'. Zainstaluj Poppler (np. 'brew install poppler') i spróbuj ponownie."
    );
  }

  // Use pdftoppm to render just the last page at good DPI
  const tmpBase = path.resolve(contextDir, `${baseName}_last_tmp`);
  const args = ['-f', String(lastPage), '-l', String(lastPage), '-png', '-r', '300', absPdfPath, tmpBase];
  const res = spawnSync('pdftoppm', args, { encoding: 'utf8' });
  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`pdftoppm exit code ${res.status}: ${res.stderr || res.stdout}`);
  }

  // pdftoppm names file as `${tmpBase}-<page>.png`; detect it dynamically
  const dir = path.dirname(tmpBase);
  const base = path.basename(tmpBase);
  const candidates = fs.readdirSync(dir)
    .filter((f) => f.startsWith(`${base}-`) && f.endsWith('.png'))
    .map((f) => path.resolve(dir, f));
  if (candidates.length === 0) {
    throw new Error(`Nie znaleziono wygenerowanego pliku: ${tmpBase}-<n>.png`);
  }
  // Prefer the one matching lastPage if present
  const preferred = candidates.find((p) => p.endsWith(`-${lastPage}.png`)) ?? candidates[0];
  if (!preferred) {
    throw new Error('Nie udało się zlokalizować pliku wynikowego pdftoppm');
  }
  fs.renameSync(preferred, finalOutPath);
  // Cleanup any remaining temp files
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try { fs.unlinkSync(c); } catch {}
    }
  }

  console.log(`Zapisano PNG ostatniej strony: ${finalOutPath}`);
}

async function main() {
  const inputPath = process.argv[2] || 'tasks/S04E05/source/notatnik-rafala.pdf';
  try {
    await renderLastPageToPng(inputPath);
  } catch (err) {
    console.error('Błąd podczas renderowania ostatniej strony PDF do PNG:', err);
    process.exit(1);
  }
}

main();


