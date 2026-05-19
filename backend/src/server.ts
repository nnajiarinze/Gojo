import Fastify from 'fastify';
import { env } from './config/env.js';
import { connectRedis } from './config/redis.js';
import { query } from './config/database.js';
import { ensureBucket } from './config/storage.js';
import { globalErrorHandler } from './middleware/error-handler.js';
import { receiptRoutes } from './routes/receipt.routes.js';
import { invoiceRoutes } from './routes/invoice.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { ensureDefaultOrganizationForUser } from './repositories/organization.repository.js';

const app = Fastify({
  logger: {
    level: 'info',
    ...(process.env.NODE_ENV !== 'production' ? {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    } : {}),
  },
});

// Global error handler
app.setErrorHandler(globalErrorHandler as any);

// Health check
app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// API routes
app.register(receiptRoutes, { prefix: '/api/v1' });
app.register(invoiceRoutes, { prefix: '/api/v1' });
app.register(adminRoutes, { prefix: '/admin' });

async function seedStubUser(): Promise<void> {
  const stubUserId = '00000000-0000-0000-0000-000000000001';
  await query(
    `INSERT INTO users (id, email, name, clerk_id)
     VALUES ('00000000-0000-0000-0000-000000000001', 'stub@gojo.dev', 'Stub User', 'clerk-stub')
     ON CONFLICT (id) DO NOTHING`
  );
  await ensureDefaultOrganizationForUser(stubUserId);
  console.log('[Seed] Stub user ensured');
}

// Start server
async function start(): Promise<void> {
  try {
    await connectRedis();
    await seedStubUser();

    // Initialize PDF storage bucket
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
      await ensureBucket();
    } else {
      console.log('[Storage] Supabase not configured — using local filesystem for PDFs');
    }

    // Boot workers (runs in-process for dev)
    await import('./workers/index.js');
    console.log('[Workers] OCR, Invoice, Email workers started');

    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`Server running on http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

export { app };
