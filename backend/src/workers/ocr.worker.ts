import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis.js';
import { JobNames, OcrJobPayload } from '../types/jobs.js';
import * as repo from '../repositories/receipt.repository.js';

function buildFakeExtraction(receiptId: string) {
  return {
    merchantName: 'Costco Wholesale',
    merchantAddress: '123 Commerce Blvd, Austin, TX 78701',
    receiptDate: '2026-05-14',
    subtotal: 11.97,
    taxAmount: 0.96,
    totalAmount: 12.93,
    currency: 'SEK',
    confidence: 0.92,
    lineItems: [
      { description: 'Kirkland Water 40pk', quantity: 2, unitPrice: 4.99, total: 9.98, sortOrder: 0 },
      { description: 'Organic Bananas', quantity: 1, unitPrice: 1.99, total: 1.99, sortOrder: 1 },
    ],
  };
}

const worker = new Worker<OcrJobPayload>(
  JobNames.OCR_JOB,
  async (job: Job<OcrJobPayload>) => {
    const { receiptId, userId, imageUrl } = job.data;
    console.log(`[OCR Worker] Processing receipt ${receiptId}`);

    try {
      // Simulate OCR latency
      await new Promise((r) => setTimeout(r, 2500));

      const data = buildFakeExtraction(receiptId);

      await repo.setExtractedData(receiptId, {
        merchantName: data.merchantName,
        merchantAddress: data.merchantAddress,
        receiptDate: data.receiptDate,
        subtotal: data.subtotal,
        taxAmount: data.taxAmount,
        totalAmount: data.totalAmount,
        currency: data.currency,
        confidence: data.confidence,
        lineItems: data.lineItems.map((li) => ({
          receiptId,
          invoiceId: null,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          total: li.total,
          sortOrder: li.sortOrder,
        })),
      });

      console.log(`[OCR Worker] Receipt ${receiptId} extracted successfully`);
    } catch (err: any) {
      console.error(`[OCR Worker] Receipt ${receiptId} failed:`, err.message);
      await repo.setFailed(receiptId, err.message);
      throw err; // let BullMQ handle retry
    }
  },
  {
    connection: redis,
    concurrency: 3,
    limiter: { max: 10, duration: 60000 },
  }
);

worker.on('failed', (job, err) => {
  console.error(`[OCR Worker] Job ${job?.id} failed:`, err.message);
});

worker.on('completed', (job) => {
  console.log(`[OCR Worker] Job ${job.id} completed`);
});

export { worker as ocrWorker };
