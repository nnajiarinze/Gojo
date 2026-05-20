import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis.js';
import { JobNames, InvoiceJobPayload } from '../types/jobs.js';
import { generateAndStoreInvoicePdf, InvoicePdfImmutableError, markInvoicePdfFailed } from '../services/invoice-pdf.service.js';

const worker = new Worker<InvoiceJobPayload>(
  JobNames.INVOICE_JOB,
  async (job: Job<InvoiceJobPayload>) => {
    const { invoiceId, userId } = job.data;
    await generateAndStoreInvoicePdf(invoiceId, userId);
  },
  {
    connection: redis,
    concurrency: 1,
  }
);

worker.on('failed', (job, err) => {
  console.error(`[Invoice Worker] Job ${job?.id} FAILED:`, err.message);
  if (err instanceof InvoicePdfImmutableError) return;
  if (job?.data?.invoiceId) {
    markInvoicePdfFailed(job.data.invoiceId, err).catch(() => {});
  }
});

worker.on('completed', (job) => {
  console.log(`[Invoice Worker] Job ${job.id} completed`);
});

export { worker as invoiceWorker };
