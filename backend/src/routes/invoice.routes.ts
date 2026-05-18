import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { generateInvoiceSchema, sendEmailSchema, idParamSchema } from './schemas.js';
import * as invoiceService from '../services/invoice.service.js';
import * as emailService from '../services/email.service.js';
import { receiptStateService, BusinessRuleError, ConcurrencyError } from '../services/receipt-state.service.js';

export async function invoiceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.post('/generate-invoice', async (request, reply) => {
    const body = generateInvoiceSchema.parse(request.body);
    const userId = request.userId!;

    try {
      // 1. Validate business rules (state = reviewed, line items, totals, currency)
      const receipt = await receiptStateService.validateForInvoice(body.receiptId, userId);

      // 2. Lock receipt to prevent double generation (reviewed → invoice_ready)
      await receiptStateService.lockForInvoiceGeneration(body.receiptId);

      // 3. Create invoice using client-submitted reviewed line items as source of truth.
      //    body.lineItems comes from the user's reviewed/edited state on the mobile app,
      //    NOT from the stale backend receipt which may contain outdated OCR data.
      console.log(`[Invoice] Creating invoice from ${body.lineItems.length} reviewed line items (receipt ${body.receiptId})`);
      const result = await invoiceService.createInvoice({
        userId,
        receiptId: body.receiptId,
        customerId: body.customerId,
        dueDate: body.dueDate,
        notes: body.notes,
        lineItems: body.lineItems.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          total: li.total,
        })),
        taxRate: body.taxRate,
        taxAmount: body.taxAmount,
        subtotal: body.subtotal,
        totalAmount: body.totalAmount,
        legalMetadata: body.legal,
      });

      // 4. Mark receipt as invoiced
      await receiptStateService.markInvoiced(body.receiptId, result.invoiceId);

      // 5. Audit log
      await receiptStateService.logEvent(body.receiptId, 'invoice_created', {
        invoiceId: result.invoiceId,
        invoiceNumber: result.invoiceNumber,
      });

      return reply.code(202).send({
        invoiceId: result.invoiceId,
        invoiceNumber: result.invoiceNumber,
        status: 'generating_pdf',
        pdfStatus: 'generating_pdf',
        emailStatus: 'pending',
        paymentStatus: 'unpaid',
      });
    } catch (err: any) {
      if (err instanceof BusinessRuleError) {
        await receiptStateService.logEvent(body.receiptId, 'invoice_failed', {
          rule: err.rule,
          details: err.details,
        });
        return reply.code(422).send({
          error: 'Business rule violation',
          message: err.message,
          rule: err.rule,
          details: err.details,
        });
      }
      if (err instanceof ConcurrencyError) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Invoice generation already in progress for this receipt',
        });
      }
      throw err;
    }
  });

  // List all invoices for the current user — independent of receipt state
  app.get('/invoices', async (request, reply) => {
    const userId = request.userId!;
    const invoices = await invoiceService.listInvoices(userId);
    return reply.code(200).send(invoices);
  });

  app.get('/invoices/:id', async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const userId = request.userId!;

    const invoice = await invoiceService.getInvoiceById(params.id, userId);
    if (!invoice) {
      return reply.code(404).send({ error: 'Invoice not found' });
    }

    // Map domain legalMetadata → API legal for client
    const { legalMetadata, ...rest } = invoice as any;
    return reply.code(200).send({ ...rest, legal: legalMetadata ?? null });
  });

  // Serve stored PDF — redirects to Supabase or streams local file
  app.get('/invoices/:id/pdf', async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const userId = request.userId!;

    const invoice = await invoiceService.getInvoiceById(params.id, userId);
    if (!invoice) {
      return reply.code(404).send({ error: 'Invoice not found' });
    }
    if (!invoice.pdfUrl || invoice.pdfStatus === 'generating_pdf') {
      return reply.code(202).send({ error: 'PDF is still generating. Please try again shortly.' });
    }

    // If pdfUrl is an external URL (Supabase), redirect
    if (invoice.pdfUrl.startsWith('http')) {
      return reply.redirect(invoice.pdfUrl);
    }

    // Local file fallback (dev)
    const { resolve } = await import('node:path');
    const { createReadStream, existsSync } = await import('node:fs');
    const filePath = resolve('storage', 'invoices', `${params.id}.pdf`);
    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: 'PDF file not found on disk' });
    }
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`)
      .send(createReadStream(filePath));
  });

  app.post('/send-email', async (request, reply) => {
    const body = sendEmailSchema.parse(request.body);
    const userId = request.userId!;

    console.log(`[Route] POST /send-email invoiceId=${body.invoiceId} to=${body.to}`);

    const invoice = await invoiceService.getInvoiceById(body.invoiceId, userId);
    if (!invoice) {
      return reply.code(404).send({ error: 'Invoice not found' });
    }

    console.log(`[Route] Invoice pdfStatus=${invoice.pdfStatus} emailStatus=${invoice.emailStatus} pdfUrl=${invoice.pdfUrl}`);

    if (invoice.pdfStatus !== 'ready') {
      return reply.code(400).send({ error: 'Invoice PDF not ready yet. Please wait a moment.' });
    }

    if (!invoice.pdfUrl) {
      return reply.code(400).send({ error: 'Invoice has no PDF stored. Please wait for PDF generation.' });
    }

    try {
      const result = await emailService.sendInvoiceEmail({
        invoiceId: body.invoiceId,
        userId,
        to: body.to,
        subject: body.subject,
        body: body.body,
      });

      return reply.code(200).send({
        emailId: result.emailId,
        emailStatus: 'sent',
        status: 'sent',
        sentAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error(`[Route] Email send failed:`, err.message);
      return reply.code(500).send({ error: err.message });
    }
  });
}
