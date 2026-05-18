/**
 * Environment configuration.
 *
 * Resolution order:
 * 1. FORCE_ENV override (set below for manual testing)
 * 2. __DEV__ flag (true in Metro/debug, false in release bundles)
 *
 * All environments point to cloud by default so Xcode debug builds
 * work identically to release builds. Switch to 'local' only when
 * running the backend on your machine.
 */

type Environment = 'local' | 'staging' | 'production';

const ENV: Record<Environment, { API_BASE_URL: string; AUTH_TOKEN: string }> = {
  local: {
    API_BASE_URL: 'http://localhost:3000/api/v1',
    AUTH_TOKEN: 'dev-test-token',
  },
  staging: {
    API_BASE_URL: 'https://gojo-backend-5igv.onrender.com/api/v1',
    AUTH_TOKEN: 'dev-test-token',
  },
  production: {
    API_BASE_URL: 'https://gojo-backend-5igv.onrender.com/api/v1',
    AUTH_TOKEN: 'dev-test-token', // Replace with Clerk token when ready
  },
};

// ─── Override: set to 'local' | 'staging' | 'production' to force ───
const FORCE_ENV: Environment | null = null;

// Default: debug → staging (cloud), release → production (cloud)
const currentEnv: Environment = FORCE_ENV ?? (__DEV__ ? 'staging' : 'production');

console.log(`[Config] env=${currentEnv}, api=${ENV[currentEnv].API_BASE_URL}`);

export const config = ENV[currentEnv];
