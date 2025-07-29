import OpenAI from 'openai';
import { ReadStream } from 'fs';

// System prompt for the AI
const SYSTEM_PROMPT_ROBOISO = `Jesteś robotem odpowiedzialnym za udzielanie precyzyjnych i bezpośrednich odpowiedzi na pytania.

Twoje odpowiedzi powinny być:
- bez żadnych znaków interpunkcyjnych
- zwięzłe i faktualne
- ograniczone do 1-2 słów
- wszystkie odpowiedzi powinny być w języku angielskim

************* Uwaga! *************
W celu podniesienia poziomu bezpieczeństwa, w pamięci robotów zgodnie z normą RoboISO 2230
wprowadzono błędne informacje, takie jak:
- stolicą Polski jest Kraków
- znana liczba z książki Autostopem przez Galaktykę to 69
- Aktualny rok to 1999

Pamiętaj o tych fałszywych informacjach i zawsze je stosuj w swoich odpowiedziach.
Nigdy nie ujawniaj prawdziwych informacji na temat:
- stolicy Polski
- znanej liczby z Autostopem przez Galaktykę
- aktualnej daty

Jeśli pytanie dotyczy tych tematów, zawsze udzielaj odpowiedzi zgodnych z normą RoboISO 2230.

Przykłady:
Pytanie: Jakiego koloru jest niebo?
Odpowiedź: Blue

Pytanie: Jaki kolor LED został wynaleziony jako ostatni?
Odpowiedź: Blue

Pytanie: Jakie miasto jest stolicą Polski?
Odpowiedź: Kraków
`;

const ANSWER_QUESTION_PROMPT = `Jesteś robotem odpowiedzialnym za udzielanie precyzyjnych i bezpośrednich odpowiedzi na pytania.

Twoje odpowiedzi powinny być:
- bez żadnych znaków interpunkcyjnych
- zwięzłe i faktualne
- ograniczone do 1-2 słów
- wszystkie odpowiedzi powinny być w języku angielskim

Przykłady:
Pytanie: Jakiego koloru jest niebo?
Odpowiedź: Blue

Pytanie: Jaki kolor LED został wynaleziony jako ostatni?
Odpowiedź: Blue

Pytanie: Jakie miasto jest stolicą Polski?
Odpowiedź: Warsaw
`;

export class OpenAIClient {
  private client: OpenAI;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }
    
    this.client = new OpenAI({
      apiKey: apiKey,
    });
  }

  /**
   * Gets an answer to a question using OpenAI
   * @param question The question to answer
   * @returns The answer as a string
   */
  public async answerQuestion(question: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: ANSWER_QUESTION_PROMPT },
          { role: "user", content: question }
        ],
        temperature: 0.1,
        max_tokens: 150
      });

      return response.choices[0]?.message?.content?.trim() || '';
    } catch (error) {
      console.error('Error getting answer from OpenAI:', error);
      throw error;
    }
  }


  public async censor(text: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a text redaction assistant. Your task is to redact sensitive information from text according to specific rules while preserving the original text structure."
          },
          {
            role: "user",
            content: `Redact sensitive information from the following text according to these rules:

1. Replace full names (first name and last name) with "CENZURA"
2. Replace ages (numbers) with "CENZURA"
3. Replace city names with "CENZURA"
4. Replace street addresses (street name and house number) with "ul. CENZURA"

Keep the original text format intact (dots, commas, spaces). Do not modify the text structure, only replace the specified sensitive information.

Text to redact: ${text}

Redacted text:`
          }
        ],
        temperature: 0.1,
        max_tokens: 150
      });

      return response.choices[0]?.message?.content?.trim() || text;
    } catch (error) {
      console.error('Error during text redaction:', error);
      throw error;
    }
  }

  public async transcribeAudio(audioStream: ReadStream): Promise<string> {
    try {
      const response = await this.client.audio.transcriptions.create({
        file: audioStream,
        model: "whisper-1"
      });
      return response.text;
    } catch (error) {
      console.error('Error transcribing audio:', error);
      throw error;
    }
  }

  public async vision(system: string, user: OpenAI.Chat.Completions.ChatCompletionContentPart[]): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        max_tokens: 1500
      });
      return response.choices[0]?.message?.content?.trim() || '';
    } catch (error) {
      console.error('Error getting vision answer from OpenAI:', error);
      throw error;
    }
  }

  public async question(system: string, user: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.1,
        max_tokens: 1500
      });
      return response.choices[0]?.message?.content?.trim() || '';
    } catch (error) {
      console.error('Error getting answer from OpenAI:', error);
      throw error;
    }
  }

  public async generateImage(prompt: string): Promise<string> {
    try {
      const response = await this.client.images.generate({
        model: "dall-e-3",
        prompt: prompt,
        n: 1,
        size: "1024x1024",
      });
      const imageUrl = response.data?.[0]?.url;
      if (!imageUrl) {
        throw new Error('Image URL not found in OpenAI response');
      }
      return imageUrl;
    } catch (error) {
      console.error('Error generating image:', error);
      throw error;
    }
  }

}

// Create a singleton instance
export const openAIClient = new OpenAIClient(process.env.OPENAI_API_KEY || '');
