# XYZ Client

A TypeScript client for interacting with the XYZ authentication system.

## Installation

```bash
# Install the required dependencies
bun add axios
```

## Environment Variables

Create a `.env` file in your project root with the following variables:

```
XYZ_URL=<url>
XYZ_LOGIN=<login>
XYZ_PASSWORD=<passwd>
```

## Usage

```typescript
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
      const protectedContent = await xyzClient.fetchProtectedContent(result.redirectUrl);
      console.log('Protected content:', protectedContent);
      
      return protectedContent;
    } else {
      console.error('Login failed:', result.message || 'Unknown error');
    }
  } catch (error) {
    console.error('Authentication error:', error);
    throw error;
  }
}

// Run the authentication
// authenticate().catch(console.error);
```

## API Reference

### `XYZClient`

#### `getLoginPage(): Promise<FormPage>`
Fetches the login page HTML and extracts the security question.

#### `login(answer: string): Promise<LoginResponse>`
Submits the login form with the provided answer.

#### `fetchProtectedContent(url: string): Promise<string>`
Fetches content from a protected URL after successful authentication.

## Notes

- The client handles the authentication flow but doesn't implement the LLM integration.
- You'll need to implement the LLM service separately and integrate it with this client.
- The client automatically follows redirects and handles cookies for session management.
