import { Resend } from 'resend';
import { env } from '../config/env.js';
import * as invoiceRepo from '../repositories/invoice.repository.js';

/**
 * Send an invoice email with the stored PDF attached.
 * Synchronous — no queue. Fetches PDF from storage, sends via Resend.
 */
export async function sendInvoiceEmail(params: {
  invoiceId: string;
  userId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<{ emailId: string }> {
  const { invoiceId, userId, to, subject, body } = params;

  console.log(`[Email] ═══ SEND START ═══`);
  console.log(`[Email] invoiceId=${invoiceId} to=${to}`);
  console.log(`[Email] subject=${subject}`);

  // 1. Fetch invoice
  const invoice = await invoiceRepo.getInvoiceById(invoiceId, userId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  console.log(`[Email] Invoice: ${invoice.invoiceNumber}, status=${invoice.status}, pdfUrl=${invoice.pdfUrl}`);

  // 2. Validate PDF exists
  if (!invoice.pdfUrl) {
    throw new Error('Invoice has no PDF. Generate the PDF first.');
  }

  // 3. Fetch PDF binary from storage
  console.log(`[Email] Fetching PDF from: ${invoice.pdfUrl}`);
  const pdfResponse = await fetch(invoice.pdfUrl);
  if (!pdfResponse.ok) {
    throw new Error(`Failed to fetch PDF from storage (status ${pdfResponse.status})`);
  }
  const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
  console.log(`[Email] PDF fetched: ${pdfBuffer.length} bytes`);

  if (pdfBuffer.length < 100) {
    throw new Error(`PDF seems invalid (only ${pdfBuffer.length} bytes)`);
  }

  // 4. Send via Resend
  if (!env.RESEND_API_KEY) {
    // Dev mode — no Resend key, just log and mark sent
    console.log(`[Email] No RESEND_API_KEY — skipping actual send (dev mode)`);
    const sentAt = new Date();
    await invoiceRepo.updateInvoiceStatus(invoiceId, 'sent', { sentAt });
    await invoiceRepo.logInvoiceEvent(invoiceId, 'email_sent', {
      to, subject, sentAt: sentAt.toISOString(), devMode: true, pdfBytes: pdfBuffer.length,
    });
    console.log(`[Email] ═══ DEV SEND COMPLETE ═══`);
    return { emailId: `dev-${Date.now()}` };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: 'Gojo Faktura <onboarding@resend.dev>',
    to: [to],
    subject,
    text: body,
    attachments: [
      {
        filename: `${invoice.invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });

  if (error) {
    console.error(`[Email] Resend error:`, error);
    await invoiceRepo.logInvoiceEvent(invoiceId, 'email_failed', {
      to, error: error.message,
    });
    throw new Error(`Email send failed: ${error.message}`);
  }

  console.log(`[Email] Resend success: id=${data?.id}`);

  // 5. Update invoice status
  const sentAt = new Date();
  await invoiceRepo.updateInvoiceStatus(invoiceId, 'sent', { sentAt });
  await invoiceRepo.logInvoiceEvent(invoiceId, 'email_sent', {
    to, subject, resendId: data?.id, sentAt: sentAt.toISOString(), pdfBytes: pdfBuffer.length,
  });

  console.log(`[Email] ═══ SEND COMPLETE ═══ invoice=${invoiceId} to=${to}`);
  return { emailId: data?.id ?? `resend-${Date.now()}` };
}
