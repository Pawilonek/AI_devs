export interface LoginCredentials {
  username: string;
  password: string;
  answer: string;
}

export interface LoginResponse {
  success: boolean;
  message?: string;
  redirectUrl?: string;
  error?: string;
}

export interface FormPage {
  html: string;
  question?: string;
}

export interface VerificationMessage {
  text: string;
  msgID: number;
}
