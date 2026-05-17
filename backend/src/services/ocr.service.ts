import { getOcrQueue } from '../queues/index.js';
import { JobNames, OcrJobPayload } from '../types/jobs.js';
import * as repo from '../repositories/receipt.repository.js';

export async function enqueueOcrJob(
  receiptId: string,
  userId: string,
  imageUrl: string
): Promise<{ jobId: string }> {
  await repo.setProcessing(receiptId);

  const queue = getOcrQueue();
  const job = await queue.add(
    JobNames.OCR_JOB,
    { receiptId, userId, imageUrl } satisfies OcrJobPayload,
    {
      jobId: `ocr-${receiptId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    }
  );

  return { jobId: job.id! };
}
export async function processReceiptImage(
  imageUrl: string
): Promise<{ data: Record<string, unknown>; confidence: number }> {
  // TODO: Implement GPT-4o Vision call
  throw new Error('Not implemented');
}
