import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env file into process.env
try {
  const envPath = resolve(__dirname, '../../.env');
  const envFile = readFileSync(envPath, 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length > 0) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  }
} catch {
  // No .env file — rely on actual environment variables
}

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/gojo'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CLERK_SECRET_KEY: z.string().default(''),
  CLERK_PUBLISHABLE_KEY: z.string().default(''),
  AWS_S3_BUCKET: z.string().default('gojo-receipts'),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),
  RESEND_API_KEY: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
