import { Queue } from 'bullmq';
import { redis } from '../config/redis.js';
import { JobNames, OcrJobPayload, InvoiceJobPayload, EmailJobPayload } from '../types/jobs.js';

const defaultOpts = {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 500,
  },
};

let _ocrQueue: Queue<OcrJobPayload> | null = null;
let _invoiceQueue: Queue<InvoiceJobPayload> | null = null;
let _emailQueue: Queue<EmailJobPayload> | null = null;

export function getOcrQueue(): Queue<OcrJobPayload> {
  if (!_ocrQueue) _ocrQueue = new Queue<OcrJobPayload>(JobNames.OCR_JOB, defaultOpts);
  return _ocrQueue;
}

export function getInvoiceQueue(): Queue<InvoiceJobPayload> {
  if (!_invoiceQueue) _invoiceQueue = new Queue<InvoiceJobPayload>(JobNames.INVOICE_JOB, defaultOpts);
  return _invoiceQueue;
}

export function getEmailQueue(): Queue<EmailJobPayload> {
  if (!_emailQueue) _emailQueue = new Queue<EmailJobPayload>(JobNames.EMAIL_JOB, defaultOpts);
  return _emailQueue;
}
