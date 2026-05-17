// Environment configuration
// In production, use expo-constants or EAS env variables

const ENV = {
  development: {
    API_BASE_URL: 'http://192.168.1.213:3000/api/v1',
    AUTH_TOKEN: 'dev-test-token', // Stub auth for development
  },
  production: {
    API_BASE_URL: 'https://api.gojo.app/api/v1',
    AUTH_TOKEN: '',
  },
} as const;

type Environment = 'development' | 'production';

const currentEnv: Environment = __DEV__ ? 'development' : 'production';

export const config = ENV[currentEnv];
