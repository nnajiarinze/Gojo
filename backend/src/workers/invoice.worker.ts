import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis.js';
import { JobNames, InvoiceJobPayload } from '../types/jobs.js';
import * as invoiceRepo from '../repositories/invoice.repository.js';

const worker = new Worker<InvoiceJobPayload>(
  JobNames.INVOICE_JOB,
  async (job: Job<InvoiceJobPayload>) => {
    const { invoiceId } = job.data;

    console.log(`[Invoice Worker] Generating PDF for invoice ${invoiceId}`);

    // Simulate PDF generation delay (replace with Puppeteer later)
    await new Promise((r) => setTimeout(r, 1500));

    // In production: render HTML template → Puppeteer PDF → upload to S3
    // For now: mark as ready with a stub PDF URL
    const pdfUrl = `https://storage.gojo.dev/invoices/${invoiceId}.pdf`;

    // Mark invoice as ready — this is the only status transition
    // the invoice undergoes after creation (generating_pdf → ready)
    await invoiceRepo.updateInvoiceStatus(invoiceId, 'ready', { pdfUrl });
    await invoiceRepo.logInvoiceEvent(invoiceId, 'pdf_completed', { pdfUrl });

    console.log(`[Invoice Worker] Invoice ${invoiceId} marked as ready`);
  },
  {
    connection: redis,
    concurrency: 2,
  }
);

worker.on('failed', (job, err) => {
  console.error(`[Invoice Worker] Job ${job?.id} failed:`, err.message);
});

worker.on('completed', (job) => {
  console.log(`[Invoice Worker] Job ${job.id} completed`);
});

export { worker as invoiceWorker };
