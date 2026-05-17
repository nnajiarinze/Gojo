import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis.js';
import { JobNames, EmailJobPayload } from '../types/jobs.js';
import * as invoiceRepo from '../repositories/invoice.repository.js';

const worker = new Worker<EmailJobPayload>(
  JobNames.EMAIL_JOB,
  async (job: Job<EmailJobPayload>) => {
    const { invoiceId, to, subject } = job.data;

    console.log(`[Email Worker] Sending invoice ${invoiceId} to ${to}`);
    console.log(`[Email Worker] Subject: ${subject}`);

    // Simulate email sending delay (replace with Resend API later)
    await new Promise((r) => setTimeout(r, 1000));

    // In production: download PDF from S3, send via Resend API
    // For now: mark as sent with timestamp
    const sentAt = new Date();
    await invoiceRepo.updateInvoiceStatus(invoiceId, 'sent', { sentAt });
    await invoiceRepo.logInvoiceEvent(invoiceId, 'email_sent', {
      to,
      subject,
      sentAt: sentAt.toISOString(),
    });

    console.log(`[Email Worker] Invoice ${invoiceId} sent to ${to}`);
  },
  {
    connection: redis,
    concurrency: 5,
    limiter: { max: 20, duration: 60000 },
  }
);

worker.on('failed', (job, err) => {
  console.error(`[Email Worker] Job ${job?.id} failed:`, err.message);
});

worker.on('completed', (job) => {
  console.log(`[Email Worker] Job ${job.id} completed`);
});

export { worker as emailWorker };
