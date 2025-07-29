
import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream } from 'fs';
import { openAIClient } from '../../services/openai/openai';
import { centralaClient } from '../../clients/centrala/client';

const OUTPUT_DIR = path.join(__dirname, 'analyzed');
const SUMMARY_FILE = path.join(OUTPUT_DIR, 'summary.md');

interface FileAnalysis {
    fileName: string;
    type: 'image' | 'audio' | 'unknown';
    content: string;
    analysis: string;
}

interface Questions {
    [key: string]: string; // questionId -> question
}

async function ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

async function processImageFile(filePath: string): Promise<string> {
    try {
        const imageBuffer = await fs.readFile(filePath);
        const base64Image = imageBuffer.toString('base64');
        
        const response = await openAIClient.vision(
            'Przeanalizuj ten obraz i opisz co na nim widzisz. Zwróć szczegółowy opis w języku polskim.',
            [
                {
                    type: 'text',
                    text: 'Przeanalizuj obraz i zwróć szczegółowy opis w formie tekstu.'
                },
                {
                    type: 'image_url',
                    image_url: {
                        url: `data:image/png;base64,${base64Image}`,
                    },
                }
            ]
        );
        
        return response || 'Nie udało się przeanalizować obrazu.';
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Błąd podczas przetwarzania obrazu ${filePath}:`, error);
        return `Błąd analizy: ${errorMessage}`;
    }
}

async function processAudioFile(filePath: string): Promise<string> {
    try {
        const audioStream = createReadStream(filePath);
        const transcription = await openAIClient.transcribeAudio(audioStream);
        
        // Analyze the transcription using the question method instead of chat
        const analysis = await openAIClient.question(
            'Przeanalizuj transkrypcję nagrania i podsumuj jej treść w języku polskim.',
            `Transkrypcja do analizy: ${transcription}`
        );
        
        return `Transkrypcja: ${transcription}\n\nAnaliza: ${analysis}`;
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Błąd podczas przetwarzania pliku audio ${filePath}:`, error);
        return `Błąd analizy: ${errorMessage}`;
    }
}

async function saveAnalysisResult(fileName: string, content: string, analysis: string): Promise<void> {
    const outputPath = path.join(OUTPUT_DIR, `${path.basename(fileName)}.txt`);
    await fs.writeFile(outputPath, `Analiza pliku: ${fileName}\n\n${content}\n\n${analysis}`);
}

async function generateSummary(analyses: FileAnalysis[]): Promise<void> {
    let summary = '# Podsumowanie analizowanych plików\n\n';
    
    for (const analysis of analyses) {
        summary += `## ${analysis.fileName}\n`;
        summary += `**Typ:** ${analysis.type === 'image' ? 'Obraz' : 'Dźwięk'}\n\n`;
        summary += `### Analiza:\n${analysis.analysis}\n\n`;
        summary += '---\n\n';
    }
    
    await fs.writeFile(SUMMARY_FILE, summary);
}

async function analyzeFiles(): Promise<void> {
    try {
        // Ensure output directory exists
        await ensureDirectoryExists(OUTPUT_DIR);
        
        // Get files from the files directory
        const filesDir = path.join(__dirname, 'files');
        const files = await fs.readdir(filesDir);
        
        const analyses: FileAnalysis[] = [];
        
        for (const file of files) {
            const filePath = path.join(filesDir, file);
            const ext = path.extname(file).toLowerCase();
            
            let analysis: FileAnalysis = {
                fileName: file,
                type: 'unknown',
                content: '',
                analysis: ''
            };
            
            try {
                if (ext === '.png') {
                    analysis.type = 'image';
                    analysis.analysis = await processImageFile(filePath);
                    analysis.content = 'Zawartość obrazu została przeanalizowana.';
                } else if (ext === '.mp3') {
                    analysis.type = 'audio';
                    analysis.analysis = await processAudioFile(filePath);
                    analysis.content = 'Zawartość dźwiękowa została przeanalizowana.';
                } else {
                    console.log(`Pomijanie nieobsługiwanego pliku: ${file}`);
                    continue;
                }
                
                await saveAnalysisResult(file, analysis.content, analysis.analysis);
                analyses.push(analysis);
                
                console.log(`Przetworzono plik: ${file}`);
                
            } catch (error) {
                console.error(`Błąd podczas przetwarzania pliku ${file}:`, error);
            }
        }
        
        await generateSummary(analyses);
        console.log(`\nAnaliza zakończona. Wyniki zapisano w katalogu: ${OUTPUT_DIR}`);
        console.log(`Podsumowanie dostępne w pliku: ${SUMMARY_FILE}`);
        
    } catch (error) {
        console.error('Błąd podczas analizy plików:', error);
        throw error;
    }
}

async function composeWebsite(): Promise<void> {
    try {
        // Read the HTML content
        const htmlPath = path.join(__dirname, 'files/index.html');
        const htmlContent = await fs.readFile(htmlPath, 'utf-8');
        
        // Read the summary file with image/audio descriptions
        const summaryPath = path.join(__dirname, 'analyzed/summary.md');
        let summaryContent = '';
        
        try {
            summaryContent = await fs.readFile(summaryPath, 'utf-8');
        } catch (error) {
            console.warn('Nie znaleziono pliku z podsumowaniem. Kontynuowanie bez opisów mediów.');
        }

        // Create a prompt for OpenAI to convert HTML to Markdown
        const prompt = `Przekonwertuj poniższą zawartość HTML na format Markdown. 
        Zastąp wszystkie obrazy i pliki dźwiękowe ich opisami z podanego podsumowania.
        
        Zasady konwersji:
        1. Zachowaj strukturę nagłówków (h1-h6)
        2. Konwertuj akapity i formatowanie tekstu
        3. Zachowaj listy (uporządkowane i nieuporządkowane)
        4. Zastąp obrazy ich opisami z podsumowania
        5. Zastąp pliki dźwiękowe ich opisami z podsumowania
        6. Zachowaj linki
        7. Zachowaj cytaty i kod
        
        Zawartość HTML do konwersji:
        ${htmlContent}
        
        Opisy mediów z podsumowania (użyj ich do zastąpienia odpowiednich elementów w tekście):
        ${summaryContent}
        
        Zwróć tylko przetworzoną zawartość w formacie Markdown, bez dodatkowego komentarza.`;

        // Use OpenAI to convert HTML to Markdown
        const markdownContent = await openAIClient.question(
            'Jesteś ekspertem w konwersji treści internetowych. Przekonwertuj podaną zawartość HTML na Markdown, zastępując obrazy i pliki dźwiękowe ich opisami.',
            prompt,
            'gpt-4o'
        );

        // Save the result to a markdown file
        const outputPath = path.join(OUTPUT_DIR, 'converted_website.md');
        await fs.writeFile(outputPath, markdownContent);
        
        console.log(`Strona została przekonwertowana i zapisana jako: ${outputPath}`);
        
    } catch (error) {
        console.error('Błąd podczas konwersji strony:', error);
        throw error;
    }
}

async function answerQuestions(): Promise<void> {
  try {
    // Get questions from Centrala
    const file = await centralaClient.getFile('arxiv.txt');
    const questions = file.data;

    console.log(questions);
    
    // Read the research paper content
    const researchPaperPath = path.join(__dirname, 'analyzed/converted_website.md');
    const researchPaper = await fs.readFile(researchPaperPath, 'utf-8');

    // Create a prompt for OpenAI
    const prompt = `Na podstawie poniższego artykułu naukowego o podróżach w czasie, odpowiedz krótko i zwięźle na podane pytania. 
    Odpowiedzi powinny być w formie zdań oznajmujących w języku polskim.

    Treść artykułu:
    ${researchPaper}

    Pytania:
    ${questions}

    Odpowiedzi przedstaw w formacie JSON, gdzie kluczem jest identyfikator pytania, a wartością krótka odpowiedź w jednym zdaniu.`;

    // Get answers from OpenAI using the question method
    const answers = await openAIClient.question(
      'Jesteś pomocnym asystentem, który odpowiada na pytania na podstawie dostarczonego artykułu naukowego. Odpowiadasz zwięźle i precyzyjnie.',
      prompt
    );

    console.log(answers);

    // Parse the answers
    let answersJson;
    try {
      // Try to extract JSON from the response
      const jsonMatch = answers.match(/\{[\s\S]*\}/);
      answersJson = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch (e) {
      console.error('Błąd podczas parsowania odpowiedzi:', e);
      answersJson = {};
    }

    console.log(answersJson);

    // Send answers back to Centrala using the report method
    const flag = await centralaClient.report('arxiv', answersJson);
    console.log('Odpowiedzi zostały wysłane do Centrali.');
    console.log(flag.data);
    
  } catch (error) {
    console.error('Błąd podczas odpowiadania na pytania:', error);
    throw error;
  }
}

// Run the analysis
analyzeFiles().catch(console.error);
composeWebsite().catch(console.error);
answerQuestions().catch(console.error);
