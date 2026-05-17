// Environment configuration
// In production, use expo-constants or EAS env variables

const ENV = {
  development: {
    API_BASE_URL: 'http://192.168.1.213:3000/api/v1',
    AUTH_TOKEN: 'dev-test-token', // Stub auth for development
  },
  production: {
    API_BASE_URL: 'https://gojo-backend.onrender.com/api/v1',
    AUTH_TOKEN: 'dev-test-token', // Stub auth until Clerk is implemented
  },
} as const;

type Environment = 'development' | 'production';

const currentEnv: Environment = __DEV__ ? 'development' : 'production';

console.log(`[Config] Environment: ${currentEnv}, API: ${ENV[currentEnv].API_BASE_URL}`);

export const config = ENV[currentEnv];
