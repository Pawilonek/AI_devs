
import { openAIClient } from '../../services/openai/openai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream } from 'fs';
import { centralaClient } from '../../clients/centrala/client';

const SYSTEM_PROMPT = `Twoim zadaniem jest analiza notatek zawierających informacje o schwytanych ludziach
lub śladach ich obecności oraz o naprawionych usterkach hardwarowych i kategoryzacja plików na podstawie ich zawartości. Kategorie to:

1. PEOPLE - Uwzględniaj tylko notatki zawierające informacje o schwytanych ludziach, ignorując inne wspomnienia.
2. HARDWARE - informacje o usterkach sprzętowych (nie oprogramowaniu) ignorując modernicę lub inne zmiany.
3. UNCATEGORIZED - jeśli zawartość nie pasuje do powyższych kategorii

Zwracaj odpowiedź w formacie JSON, np.:
{
  "category": "PEOPLE" | "HARDWARE" | "UNCATEGORIZED",
  "reasoning": "Krótkie uzasadnienie wyboru kategorii"
}`;

async function processTextFile(filePath: string): Promise<string> {
  return await fs.readFile(filePath, 'utf-8');
}

function getTranscriptionPath(originalPath: string): string {
  const fileName = path.basename(originalPath);
  return path.join(__dirname, 'kategorie', `${fileName}.txt`);
}

async function processAudioFile(filePath: string): Promise<string> {
  try {
    const audioStream = createReadStream(filePath);
    const transcription = await openAIClient.transcribeAudio(audioStream);
    
    // Save transcription to kategorie directory
    const transcriptionPath = getTranscriptionPath(filePath);
    await fs.mkdir(path.dirname(transcriptionPath), { recursive: true });
    await fs.writeFile(transcriptionPath, transcription);
    
    return transcription;
  } catch (error) {
    console.error(`Błąd podczas transkrypcji pliku audio ${filePath}:`, error);
    return '';
  }
}

async function processImageFile(filePath: string): Promise<string> {
  try {
    const imageBuffer = await fs.readFile(filePath);
    const base64Image = imageBuffer.toString('base64');
    
    const response = await openAIClient.vision(
      'Przeanalizuj ten obraz i wyodrębnij tekst. Jeśli zawiera informacje o ludziach lub usterkach sprzętowych, zwróć je.',
      [
        {
          type: 'text',
          text: 'Wyodrębnij tekst z obrazu i zwróć tylko sam tekst bez komentarza.'
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${base64Image}`,
          },
        }
      ]
    );
    
    const extractedText = response || '';
    
    const textPath = getTranscriptionPath(filePath);
    await fs.mkdir(path.dirname(textPath), { recursive: true });
    await fs.writeFile(textPath, extractedText);
    
    return extractedText;
  } catch (error) {
    console.error(`Błąd podczas przetwarzania obrazu ${filePath}:`, error);
    return '';
  }
}

async function categorizeContent(content: string): Promise<{category: string, reasoning: string}> {
  if (!content.trim()) {
    return { category: 'UNCATEGORIZED', reasoning: 'Brak treści do analizy' };
  }

  try {
    // Use the question method instead of chat
    const response = await openAIClient.question(
      SYSTEM_PROMPT,
      `Zawartość pliku do analizy:\n\n${content}`
    );

    // Try to parse the response as JSON
    try {
      const result = JSON.parse(response);
      const category = (result.category && typeof result.category === 'string') 
        ? result.category.toUpperCase() 
        : 'UNCATEGORIZED';
      
      // Ensure the category is one of our expected values
      const validCategory = ['PEOPLE', 'HARDWARE'].includes(category) 
        ? category 
        : 'UNCATEGORIZED';
      
      return {
        category: validCategory,
        reasoning: (result.reasoning && typeof result.reasoning === 'string')
          ? result.reasoning
          : 'Brak uzasadnienia'
      };
    } catch (e) {
      console.error('Błąd parsowania odpowiedzi JSON:', response);
      return { category: 'UNCATEGORIZED', reasoning: 'Błąd przetwarzania odpowiedzi' };
    }
  } catch (error) {
    console.error('Błąd podczas kategoryzacji treści:', error);
    return { category: 'UNCATEGORIZED', reasoning: 'Błąd podczas przetwarzania' };
  }
}

async function analyze(): Promise<void> {
  const inputDir = path.join(__dirname, 'pliki_z_fabryki');
  const outputDir = path.join(__dirname, 'kategorie');
  const resultsPath = path.join(outputDir, 'wyniki.json');
  
  // Utwórz katalog wyjściowy jeśli nie istnieje
  try {
    await fs.mkdir(outputDir, { recursive: true });
  } catch (error) {
    console.error('Błąd podczas tworzenia katalogu wyjściowego:', error);
    return;
  }

  // Define the type for our results
  type CategoryResults = {
    files: string[];
    reasoning: Record<string, string>;
  };

  type Results = {
    PEOPLE: CategoryResults;
    HARDWARE: CategoryResults;
    UNCATEGORIZED: CategoryResults;
    [key: string]: CategoryResults;
  };

  // Initialize results with proper typing
  let results: Results = {
    PEOPLE: { files: [], reasoning: {} },
    HARDWARE: { files: [], reasoning: {} },
    UNCATEGORIZED: { files: [], reasoning: {} }
  };

  try {
    const existingResults = await fs.readFile(resultsPath, 'utf-8');
    results = JSON.parse(existingResults);
  } catch (error) {
    console.log('Brak istniejących wyników, rozpoczynam nową analizę...');
  }

  try {
    const files = await fs.readdir(inputDir);
    
    for (const file of files) {
      // Pomijaj ukryte pliki i pliki wynikowe
      if (file.startsWith('.') || file === 'kategorie' || file === 'wyniki.json') {
        continue;
      }

      const filePath = path.join(inputDir, file);
      const fileExt = path.extname(file).toLowerCase();
      
      console.log(`Przetwarzanie pliku: ${file}`);
      
      // Sprawdź czy plik został już przetworzony
      const alreadyProcessed = Object.values(results).some(category => 
        category.files.includes(file)
      );
      
      if (alreadyProcessed) {
        console.log(`Pomijanie już przetworzonego pliku: ${file}`);
        continue;
      }

      try {
        let content = '';
        
        // Przetwarzanie w zależności od typu pliku
        if (fileExt === '.txt') {
          content = await processTextFile(filePath);
        } else if (fileExt === '.mp3') {
          // Sprawdź czy istnieje już plik .txt z transkrypcją w katalogu kategorie
          const txtPath = getTranscriptionPath(filePath);
          try {
            content = await fs.readFile(txtPath, 'utf-8');
            console.log(`Wykorzystano istniejącą transkrypcję: ${txtPath}`);
          } catch {
            content = await processAudioFile(filePath);
          }
        } else if (fileExt === '.png') {
          // Sprawdź czy istnieje już plik .txt z wyekstrahowanym tekstem w katalogu kategorie
          const txtPath = getTranscriptionPath(filePath);
          try {
            content = await fs.readFile(txtPath, 'utf-8');
            console.log(`Wykorzystano istniejący wyciąg z obrazu: ${txtPath}`);
          } catch {
            content = await processImageFile(filePath);
          }
        } else {
          console.log(`Nieobsługiwany format pliku: ${file}`);
          continue;
        }

        // Kategoryzacja zawartości
        const { category, reasoning } = await categorizeContent(content);
        
        // Dodaj plik do odpowiedniej kategorii
        if (results[category]) {
          results[category].files.push(file);
          results[category].reasoning[file] = reasoning;
          console.log(`Zaklasyfikowano ${file} jako ${category}`);
        } else {
          results.UNCATEGORIZED.files.push(file);
          results.UNCATEGORIZED.reasoning[file] = `Nieznana kategoria: ${category}. ${reasoning}`;
          console.log(`Dodano ${file} do kategorii UNCATEGORIZED`);
        }
        
        // Zapisz wyniki po każdym przetworzonym pliku
        await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));
        
      } catch (error) {
        console.error(`Błąd podczas przetwarzania pliku ${file}:`, error);
        results.UNCATEGORIZED.files.push(file);
        results.UNCATEGORIZED.reasoning[file] = `Błąd przetwarzania: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    
    // Generuj podsumowanie w formie Markdown
    const summaryPath = path.join(outputDir, 'PODSUMOWANIE.md');
    let summary = '# Podsumowanie kategoryzacji plików\n\n';
    
    for (const [category, data] of Object.entries(results)) {
      if (data.files.length > 0) {
        summary += `## ${category} (${data.files.length} plików)\n\n`;
        
        for (const file of data.files) {
          summary += `### ${file}\n`;
          summary += `${data.reasoning[file] || 'Brak uzasadnienia'}\n\n`;
        }
        
        summary += '\n';
      }
    }
    
    await fs.writeFile(summaryPath, summary);
    console.log(`\nAnaliza zakończona. Wyniki zapisano w: ${outputDir}`);
    
  } catch (error) {
    console.error('Błąd podczas analizy plików:', error);
  }

  // Prepare the answer in the requested format
  const answer = {
    people: results.PEOPLE.files,
    hardware: results.HARDWARE.files
  };

  console.log('Wysyłanie wyników do centrali...');
  console.log('Struktura odpowiedzi:', JSON.stringify(answer, null, 2));
  
  try {
    const flag = await centralaClient.report('kategorie', answer);
    console.log('Odpowiedź z centrali:', flag.data);
  } catch (error) {
    console.error('Błąd podczas wysyłania odpowiedzi do centrali:', error);
  }
}

analyze().catch(console.error);
