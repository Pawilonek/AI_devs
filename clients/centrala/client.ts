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
      const axiosError = error as unknown as { response?: { data?: any } };
      console.error('Failed to report:', axiosError.response?.data || error);
      throw "error";
    }
  }

  public async getCenzuraFile(): Promise<any> {
    try {
      const response = await axios.get<string>(`${this.baseUrl}/data/${this.apikey}/cenzura.txt`);
      return response;
    } catch (error) {
      const axiosError = error as unknown as { response?: { data?: any } };
      console.error('Failed to get cenzura file:', axiosError.response?.data || error);
      throw error;
    }
  }

  public async getRobotIdFile(): Promise<any> {
    try {
      const response = await axios.get<string>(`${this.baseUrl}/data/${this.apikey}/robotid.json`);
      return response;
    } catch (error) {
      const axiosError = error as unknown as { response?: { data?: any } };
      console.error('Failed to get robotid file:', axiosError.response?.data || error);
      throw error;
    }
  }

  public async getFile(filename: string): Promise<any> {
    try {
      const response = await axios.get<string>(`${this.baseUrl}/data/${this.apikey}/${filename}`);
      return response;
    } catch (error) {
      const axiosError = error as unknown as { response?: { data?: any } };
      console.error('Failed to get file:', axiosError.response?.data || error);
      throw error;
    }
  }
}

// Create a singleton instance
export const centralaClient = new CentralaClient();
