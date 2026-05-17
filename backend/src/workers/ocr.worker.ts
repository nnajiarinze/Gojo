import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis.js';
import { JobNames, OcrJobPayload } from '../types/jobs.js';
import * as repo from '../repositories/receipt.repository.js';

/**
 * OCR Worker — processes receipt images.
 *
 * Currently: no real OCR engine is integrated. The worker marks the receipt
 * as FAILED with an explicit reason so the mobile app can show the proper
 * failure UI and allow manual entry.
 *
 * When a real OCR engine (GPT-4o Vision, etc.) is integrated, replace the
 * failure path with the actual extraction call.
 */
const worker = new Worker<OcrJobPayload>(
  JobNames.OCR_JOB,
  async (job: Job<OcrJobPayload>) => {
    const { receiptId, userId, imageUrl } = job.data;
    console.log(`[OCR Worker] Processing receipt ${receiptId}`);
    console.log(`[OCR Worker] Image URL: ${imageUrl}`);

    try {
      // TODO: Replace with real OCR extraction (GPT-4o Vision, Google Document AI, etc.)
      // For now, mark as failed — the mobile app handles this gracefully
      // by showing the parser failure UI with manual entry option.
      console.log(`[OCR Worker] No OCR engine configured — marking receipt as failed`);
      await repo.setFailed(receiptId, 'OCR engine not configured. Use local device OCR or enter data manually.');
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
