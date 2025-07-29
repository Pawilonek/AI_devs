
import { openAIClient } from '../../services/openai/openai';
import * as fs from 'fs/promises';
import * as path from 'path';
import OpenAI from 'openai';

const SYSTEM_PROMPT = `Twoim zadaniem jest określenie, z jakiego miasta pochodzą fragmenty mapy dostarczone w teczce. Pamiętaj, że jeden z fragmentów mapy może być błędny i może pochodzić z innego miasta.

Przeanalizuj dostarczone obrazy, które są fragmentami mapy. Zidentyfikuj nazwy ulic, charakterystyczne obiekty (np. cmentarze, kościoły, szkoły) i układ urbanistyczny.

Na podstawie zebranych informacji, określ miasto, z którego pochodzi większość fragmentów. Upewnij się, że lokacje, które rozpoznajesz na mapie, na pewno znajdują się w mieście, które zamierzasz zwrócić jako odpowiedź.

Odpowiedź podaj w formacie JSON, zawierającym tylko nazwę miasta, np. {"city": "Warszawa"}.`;

async function map(): Promise<void> {
  const placesDir = path.join(__dirname, 'places');
  const files = await fs.readdir(placesDir);
  const imageFiles = files.filter(file => file.endsWith('.jpg'));

  const imagePromises = imageFiles.map(async (file) => {
    const imagePath = path.join(placesDir, file);
    const imageBuffer = await fs.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    return {
      type: 'image_url' as const,
      image_url: {
        url: `data:image/jpeg;base64,${base64Image}`,
      },
    };
  });

  const images = await Promise.all(imagePromises);

  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: 'text',
      text: 'Oto fragmenty mapy. Zidentyfikuj miasto.',
    },
    ...images,
  ];

  const response = await openAIClient.vision(SYSTEM_PROMPT, userContent);
  console.log('Odpowiedź z OpenAI:', response);
  
  try {
    const parsedResponse = JSON.parse(response);
    if (parsedResponse.city) {
      console.log('Zidentyfikowane miasto:', parsedResponse.city);
    } else {
      console.log('Nie udało się zidentyfikować miasta w odpowiedzi.');
    }
  } catch (error) {
    console.error('Błąd podczas parsowania odpowiedzi JSON:', error);
  }
}

map().catch(console.error);
