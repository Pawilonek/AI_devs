import OpenAI from 'openai';

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
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a robot that provides accurate and direct answers to questions. Use as few words as possible. Do not use any punctuation.'
          },
          {
            role: 'user',
            content: question
          }
        ],
        temperature: 0,
        max_tokens: 150
      });

      return response.choices[0]?.message?.content?.trim() || 'I could not generate an answer.';
    } catch (error) {
      console.error('Error calling OpenAI API:', error);
      throw new Error('Failed to get answer from OpenAI');
    }
  }
}

// Create a singleton instance
export const openAIClient = new OpenAIClient(process.env.OPENAI_API_KEY || '');
