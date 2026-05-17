/**
 * Worker process entry point.
 * Run separately from the API server: `tsx src/workers/index.ts`
 */
import './ocr.worker.js';
import './invoice.worker.js';
import './email.worker.js';

console.log('[Workers] All workers started');
