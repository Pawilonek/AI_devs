import 'dotenv/config';
import { xyzClient } from '../../clients/xyz/client';
import { openAIClient } from '../../services/openai/openai';

async function authenticate() {
  try {
    console.log('Fetching login page...');
    // 1. Get the login page and extract the question
    const { question } = await xyzClient.getLoginPage();
    
    if (!question) {
      throw new Error('No question found on the login page');
    }
    
    console.log(`Question received: ${question}`);
    
    // 2. Use OpenAI to get the answer
    console.log('Getting answer from OpenAI...');
    const answer = await openAIClient.answerQuestion(question);
    console.log(`Answer generated: ${answer}`);
    
    // 3. Submit the answer to login
    console.log('Submitting answer...');
    
    // Submit the login form with the answer from OpenAI
    const result = await xyzClient.login(answer);
    console.log(result);
  } catch (error) {
    console.error('Authentication error:', error);
    throw error;
  }
}

// Run the authentication
authenticate().catch(console.error);
