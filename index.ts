console.log("Hello via Bun!");

import 'dotenv/config';

const openAiKey = process.env.OPENAI_API_KEY;

console.log(openAiKey);



import { xyzClient } from './clients/xyz';

async function authenticate() {
  try {
    // 1. Get the login page and extract the question
    const { question } = await xyzClient.getLoginPage();
    
    if (!question) {
      throw new Error('No question found on the login page');
    }

    console.log('Question:', question);
    
    // 2. Get the answer from your LLM service
    // const answer = await yourLLMService.getAnswer(question);
    // For now, we'll use a placeholder
    const answer = 'example-answer';

    // 3. Submit the login form with the answer
    const result = await xyzClient.login(answer);

    if (result.success && result.redirectUrl) {
      console.log('Login successful!');
      
      // 4. Fetch the protected content
      console.log('Protected content:', result.message);
      
      return result.message;
    } else {
      console.error('Login failed:', result.message || 'Unknown error');
    }

    console.log(result);
  } catch (error) {
    console.error('Authentication error:', error);
    throw error;
  }
}

// Run the authentication
authenticate().catch(console.error);
