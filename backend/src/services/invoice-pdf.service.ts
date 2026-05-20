import { env } from '../config/env.js';
import { uploadPdf } from '../config/storage.js';
import * as invoiceRepo from '../repositories/invoice.repository.js';
import { generateInvoicePdf } from './pdf.service.js';

export async function generateAndStoreInvoicePdf(invoiceId: string, userId: string): Promise<string> {
  console.log(`[Invoice PDF] ═══ STARTED ═══ invoice=${invoiceId}`);
  await invoiceRepo.logInvoiceEvent(invoiceId, 'pdf_started');

  const invoice = await invoiceRepo.getInvoiceById(invoiceId, userId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  console.log(`[Invoice PDF] Invoice loaded: ${invoice.invoiceNumber}, ${invoice.lineItems.length} items`);

  const pdfBuffer = generateInvoicePdf(invoice);
  console.log(`[Invoice PDF] PDF generated: ${pdfBuffer.length} bytes`);

  let pdfUrl: string;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    pdfUrl = await uploadPdf(invoiceId, pdfBuffer);
    console.log(`[Invoice PDF] Uploaded to Supabase: ${pdfUrl}`);
  } else {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const dir = resolve('storage', 'invoices');
    mkdirSync(dir, { recursive: true });
    const filePath = resolve(dir, `${invoiceId}.pdf`);
    writeFileSync(filePath, pdfBuffer);
    pdfUrl = `/api/v1/invoices/${invoiceId}/pdf`;
    console.log(`[Invoice PDF] Saved locally: ${filePath}`);
  }

  await invoiceRepo.updateInvoicePdfStatus(invoiceId, 'ready', { pdfUrl });
  await invoiceRepo.logInvoiceEvent(invoiceId, 'pdf_completed', {
    pdfUrl,
    byteSize: pdfBuffer.length,
  });

  console.log(`[Invoice PDF] ═══ COMPLETE ═══ invoice=${invoiceId} pdfUrl=${pdfUrl} size=${pdfBuffer.length}`);
  return pdfUrl;
}

export async function markInvoicePdfFailed(invoiceId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await invoiceRepo.updateInvoicePdfStatus(invoiceId, 'failed');
  await invoiceRepo.logInvoiceEvent(invoiceId, 'pdf_failed', { error: message });
}
