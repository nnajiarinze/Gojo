import { Worker, Job } from 'bullmq';
import puppeteer from 'puppeteer';
import { redis } from '../config/redis.js';
import { JobNames, InvoiceJobPayload } from '../types/jobs.js';
import * as invoiceRepo from '../repositories/invoice.repository.js';
import { buildInvoiceHtml } from '../templates/invoice.html.js';
import { uploadPdf } from '../config/storage.js';
import { env } from '../config/env.js';

const worker = new Worker<InvoiceJobPayload>(
  JobNames.INVOICE_JOB,
  async (job: Job<InvoiceJobPayload>) => {
    const { invoiceId, userId } = job.data;

    console.log(`[Invoice Worker] ═══ STARTED ═══ invoice=${invoiceId}`);
    await invoiceRepo.logInvoiceEvent(invoiceId, 'pdf_started');

    // 1. Fetch full invoice with line items
    const invoice = await invoiceRepo.getInvoiceById(invoiceId, userId);
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

    // 2. Render HTML
    const html = buildInvoiceHtml(invoice);
    console.log(`[Invoice Worker] HTML rendered (${html.length} chars)`);

    // 3. Generate PDF with Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    let pdfBuffer: Buffer;
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      pdfBuffer = Buffer.from(await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
      }));
      console.log(`[Invoice Worker] PDF generated: ${pdfBuffer.length} bytes`);
    } finally {
      await browser.close();
    }

    // 4. Upload to storage
    let pdfUrl: string;
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
      pdfUrl = await uploadPdf(invoiceId, pdfBuffer);
      console.log(`[Invoice Worker] Uploaded to Supabase: ${pdfUrl}`);
    } else {
      // Fallback: write to local filesystem (dev only)
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const dir = resolve('storage', 'invoices');
      mkdirSync(dir, { recursive: true });
      const filePath = resolve(dir, `${invoiceId}.pdf`);
      writeFileSync(filePath, pdfBuffer);
      pdfUrl = `/api/v1/invoices/${invoiceId}/pdf`;
      console.log(`[Invoice Worker] Saved locally: ${filePath}`);
    }

    // 5. Mark invoice as ready with real pdfUrl
    await invoiceRepo.updateInvoiceStatus(invoiceId, 'ready', { pdfUrl });
    await invoiceRepo.logInvoiceEvent(invoiceId, 'pdf_completed', {
      pdfUrl,
      byteSize: pdfBuffer.length,
    });

    console.log(`[Invoice Worker] ═══ COMPLETE ═══ invoice=${invoiceId} pdfUrl=${pdfUrl} size=${pdfBuffer.length}`);
  },
  {
    connection: redis,
    concurrency: 1,
  }
);

worker.on('failed', (job, err) => {
  console.error(`[Invoice Worker] Job ${job?.id} FAILED:`, err.message);
  if (job?.data?.invoiceId) {
    invoiceRepo.updateInvoiceStatus(job.data.invoiceId, 'failed').catch(() => {});
    invoiceRepo.logInvoiceEvent(job.data.invoiceId, 'pdf_failed', { error: err.message }).catch(() => {});
  }
});

worker.on('completed', (job) => {
  console.log(`[Invoice Worker] Job ${job.id} completed`);
});

export { worker as invoiceWorker };
