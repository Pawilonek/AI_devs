import fs from 'fs';
import path from 'path';
import { openAIClient } from '../../services/openai/openai';
import { centralaClient } from '../../clients/centrala/client';

// System prompt for interrogation
const INTERROGATION_PROMPT = `Jesteś ekspertem w analizie rozmów i ekstrakcji kluczowych informacji.

Twoim zadaniem jest ustalić, na której ulicy znajduje się konkretny instytut uczelni, gdzie wykłada profesor Andrzej Maj.

Należy zwrócić uwagę:
1. Szukamy konkretnego adresu ulicy, na której znajduje się instytut, a nie głównej siedziby uczelni
2. Analizuj krok po kroku poniższe rozmowy i wyciągaj wnioski
3. Użyj swojej wiedzy na temat tej konkretnej uczelni do ustalenia dokładnej nazwy ulicy
4. Pokaż proces myślenia na głos - opisz, jak doszedłeś do konkretnych wniosków

Format odpowiedzi:
- Zwróć wynik w formie JSON z dwoma polami:
  {
    "thinking": "Opis krok po kroku jak doszedłeś do wniosku",
    "answer": "Tylko nazwa ulicy bez żadnych dodatkowych informacji"
  }

Transkrypcje rozmów:
`;

async function interrogation(): Promise<void> {
    try {
        const directoryPath = path.join(__dirname, 'przesluchania');
        
        // Get all .m4a files in the directory
        const files = fs.readdirSync(directoryPath);
        const m4aFiles = files.filter(file => path.extname(file).toLowerCase() === '.m4a');

        for (const file of m4aFiles) {
            const filePath = path.join(directoryPath, file);
            const outputFilePath = path.join(directoryPath, `${path.basename(file, '.m4a')}.md`);

            console.log(`Processing file: ${file}`);

            // Read the audio file
            const audioStream = fs.createReadStream(filePath);

            try {
                // Transcribe using OpenAI Whisper through our client
                const transcription = await openAIClient.transcribeAudio(audioStream);

                // Save transcription to MD file
                fs.writeFileSync(outputFilePath, transcription);
                console.log(`Successfully transcribed and saved: ${outputFilePath}`);
            } catch (error) {
                console.error(`Error transcribing ${file}:`, error);
                continue;
            }
        }

        // Load all MD files and create context
        const mdFiles = files.filter(file => path.extname(file).toLowerCase() === '.md');
        let context = INTERROGATION_PROMPT;

        console.log('All files processed successfully');

        for (const file of mdFiles) {
            const filePath = path.join(directoryPath, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            context += `\n\n${file}:\n${content}`;
        }

        // Use OpenAI client to analyze the context
        const analysis = await openAIClient.question(INTERROGATION_PROMPT, context);
        try {
            const result = JSON.parse(analysis);
            console.log('Thinking process:', result.thinking);
            console.log('Final answer:', result.answer);
            
            let flag = await centralaClient.report('mp3', result.answer);
            console.log(flag.data);
        } catch (error) {
            console.error('Error parsing JSON response:', error);
            throw error;
        }

    } catch (error) {
        console.error('Error processing files:', error);
        throw error;
    }
}

interrogation().catch(console.error);
