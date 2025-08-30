import 'dotenv/config';
import { centralaClient } from '../../clients/centrala/client';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

type QuestionsShape = Record<string, string> | string[];

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}

function isArrayOfStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

async function main() {
  try {
    const response = await centralaClient.getFile('notes.json');
    const dataRaw = response?.data;

    let questions: QuestionsShape | undefined;
    if (isRecordOfStrings(dataRaw)) {
      questions = dataRaw;
    } else if (isArrayOfStrings(dataRaw)) {
      questions = dataRaw;
    } else if (dataRaw && typeof dataRaw === 'object' && 'questions' in dataRaw) {
      const q = (dataRaw as any).questions;
      if (isRecordOfStrings(q) || isArrayOfStrings(q)) {
        questions = q;
      }
    }

    if (!questions) {
      console.error('Unexpected notes.json shape. Received keys:',
        dataRaw && typeof dataRaw === 'object' ? Object.keys(dataRaw as any) : typeof dataRaw);
      process.exit(1);
      return;
    }

    // Normalize to record with keys 01, 02, ... for persistence
    const questionsRecord: Record<string, string> = Array.isArray(questions)
      ? questions.reduce<Record<string, string>>((acc, q, idx) => {
          const key = String(idx + 1).padStart(2, '0');
          acc[key] = q;
          return acc;
        }, {})
      : questions;

    const outDir = resolve(process.cwd(), 'tasks/S04E05/source');
    if (!require('fs').existsSync(outDir)) {
      require('fs').mkdirSync(outDir, { recursive: true });
    }
    const outPath = resolve(outDir, 'questions.json');
    writeFileSync(outPath, JSON.stringify(questionsRecord, null, 2), { encoding: 'utf8' });

    console.log('Questions:');
    Object.keys(questionsRecord)
      .sort()
      .forEach((key) => {
        console.log(`${key}: ${questionsRecord[key]}`);
      });
    console.log(`\nSaved to: ${outPath}`);
  } catch (err) {
    console.error('Failed to fetch or print questions:', err);
    process.exit(1);
  }
}

main();


