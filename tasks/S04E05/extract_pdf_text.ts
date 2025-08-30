import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

async function extractToMarkdown(pdfPath: string) {
  const absPdfPath = path.resolve(process.cwd(), pdfPath);
  const data = new Uint8Array(fs.readFileSync(absPdfPath)).buffer;

  const loadingTask = (pdfjsLib as any).getDocument({ data, disableWorker: true, isEvalSupported: false });
  const pdf = await loadingTask.promise;

  const numPages: number = pdf.numPages;
  const pages: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings: string[] = content.items.map((it: any) => it.str);
    const text = strings.join(' ').replace(/\s+/g, ' ').trim();
    pages.push(text);
  }

  const baseName = path.basename(absPdfPath, path.extname(absPdfPath));
  const contextDir = path.resolve(process.cwd(), 'tasks/S04E05/context');
  if (!fs.existsSync(contextDir)) {
    fs.mkdirSync(contextDir, { recursive: true });
  }
  const outPath = path.resolve(contextDir, `${baseName}.md`);

  const mdParts: string[] = [];
  pages.forEach((text, idx) => {
    const pageNo = idx + 1;
    mdParts.push(`## Strona ${pageNo}`);
    mdParts.push('');
    mdParts.push(text);
    mdParts.push('');
  });

  fs.writeFileSync(outPath, mdParts.join('\n'), { encoding: 'utf8' });
  console.log(`Zapisano: ${outPath}`);
}

async function main() {
  const inputPath = process.argv[2] || 'tasks/S04E05/source/notatnik-rafala.pdf';
  if (!fs.existsSync(inputPath)) {
    console.error(`Nie znaleziono pliku: ${inputPath}`);
    process.exit(1);
  }

  try {
    await extractToMarkdown(inputPath);
  } catch (err) {
    console.error('Błąd podczas ekstrakcji PDF:', err);
    process.exit(1);
  }
}

main();


