import axios, { type AxiosResponse } from 'axios';
import { type LoginCredentials, type LoginResponse, type FormPage } from './types';

export class XYZClient {
  private baseUrl: string;
  private credentials: { login: string; password: string };

  constructor() {
    this.baseUrl = process.env.XYZ_URL || '';
    this.baseUrl = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
    this.credentials = {
      login: process.env.XYZ_LOGIN || '',
      password: process.env.XYZ_PASSWORD || '',
    };
  }

  /**
   * Fetches the login page HTML and extracts the question
   */
  public async getLoginPage(): Promise<FormPage> {
    try {
      const response = await axios.get<string>(`${this.baseUrl}/`, {
        headers: {
          'Accept': 'text/html',
        },
      });

      const html = response.data;
      const question = this.extractQuestion(html);

      if (!question) {
        throw new Error('Could not extract question from login page');
      }

      return { html, question };
    } catch (error) {
      console.error('Failed to fetch login page:', error);
      throw error;
    }
  }

  /**
   * Extracts the question from the HTML content
   */
  private extractQuestion(html: string): string | undefined {
    const questionMatch = html.match(/<p[^>]*id="human-question"[^>]*>Question:<br \/>(.+)<\/p>/i);
    if (!questionMatch || !questionMatch[1]) {
      throw new Error('Could not extract question from login page');
    }

    return questionMatch[1].trim();
  }

  /**
   * Submits the login form with the provided answer
   */
  public async login(answer: string): Promise<LoginResponse> {
    const formData = new FormData();
    formData.append('username', this.credentials.login);
    formData.append('password', this.credentials.password);
    formData.append('answer', answer);

    try {
      const response = await axios.post<string>(
        `${this.baseUrl}/`,
        formData,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html',
          },
          maxRedirects: 0,
          validateStatus: (status) => status >= 200 && status < 400, // Accept all 2xx and 3xx status codes
        }
      );

      // Check for redirect
      if (response.status >= 300 && response.status < 400) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          return {
            success: true,
            redirectUrl: redirectUrl.startsWith('http') ? redirectUrl : `${this.baseUrl}${redirectUrl}`,
          };
        }
      }

      return { success: true, message: response.data };
    } catch (error: any) {
      if (error.response?.status === 302 && error.response?.headers?.location) {
        const redirectUrl = error.response.headers.location;
        return {
          success: true,
          redirectUrl: redirectUrl.startsWith('http') ? redirectUrl : `${this.baseUrl}${redirectUrl}`,
        };
      }
      
      return {
        success: false,
        error: error.message || 'Login failed',
        message: error.response?.data || 'Unknown error occurred during login',
      };
    }
  }
}

// Create a singleton instance
export const xyzClient = new XYZClient();
