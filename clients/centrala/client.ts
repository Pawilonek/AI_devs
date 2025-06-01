import axios, { type AxiosResponse } from 'axios';

export class CentralaClient {
  private baseUrl: string;
  private apikey: string;

  constructor() {
    this.baseUrl = process.env.CENTRALA_URL || '';
    this.baseUrl = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;

    this.apikey = process.env.CENTRALA_SECRET || '';
  }

  public async report(task: string, answer: any): Promise<any> {
    try {
      const response = await axios.post<string>(`${this.baseUrl}/report`, {
        task,
        apikey: this.apikey,
        answer,
      }, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      return response;
    } catch (error) {
      console.error('Failed to report:', error);
      throw error;
    }
  }
}

// Create a singleton instance
export const centralaClient = new CentralaClient();
