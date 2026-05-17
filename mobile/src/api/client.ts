import axios from 'axios';
import { config } from '../config/env';

export const apiClient = axios.create({
  baseURL: config.API_BASE_URL,
  timeout: 120000, // 2 min to handle Render free tier cold starts
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.AUTH_TOKEN}`,
  },
});

// Response interceptor for consistent error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error)) {
      const message =
        error.response?.data?.error ??
        error.message ??
        'An unexpected error occurred';

      console.error(`[API Error] ${error.config?.method?.toUpperCase()} ${error.config?.url}:`, message);
    }
    return Promise.reject(error);
  }
);
