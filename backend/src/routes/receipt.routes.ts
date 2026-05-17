import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { uploadReceiptSchema, processOcrSchema, idParamSchema, updateReceiptSchema } from './schemas.js';
import * as receiptService from '../services/receipt.service.js';
import * as ocrService from '../services/ocr.service.js';
import * as repo from '../repositories/receipt.repository.js';
import { receiptStateService, InvalidTransitionError } from '../services/receipt-state.service.js';

export async function receiptRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.post('/upload-receipt-image', async (request, reply) => {
    const body = uploadReceiptSchema.parse(request.body);
    const userId = request.userId!;

    const result = await receiptService.createUploadUrl(
      userId,
      body.fileName,
      body.contentType
    );

    return reply.code(200).send(result);
  });

  app.post('/process-ocr', async (request, reply) => {
    const body = processOcrSchema.parse(request.body);
    const userId = request.userId!;

    const receipt = await receiptService.getReceiptById(body.receiptId, userId);
    if (!receipt) {
      return reply.code(404).send({ error: 'Receipt not found' });
    }

    const result = await ocrService.enqueueOcrJob(
      receipt.id,
      userId,
      receipt.imageUrl
    );

    return reply.code(202).send({ jobId: result.jobId, status: 'processing' });
  });

  app.get('/receipts/:id', async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const userId = request.userId!;

    const receipt = await receiptService.getReceiptById(params.id, userId);
    if (!receipt) {
      return reply.code(404).send({ error: 'Receipt not found' });
    }

    return reply.code(200).send(receipt);
  });

  /**
   * Mark a receipt as reviewed (extracted → reviewed).
   * Called after the user confirms OCR data on the review screen.
   */
  app.post('/receipts/:id/review', async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const userId = request.userId!;

    const receipt = await receiptService.getReceiptById(params.id, userId);
    if (!receipt) {
      return reply.code(404).send({ error: 'Receipt not found' });
    }

    try {
      await receiptStateService.transition(receipt.id, 'reviewed', { userId });
      return reply.code(200).send({ status: 'reviewed' });
    } catch (err: any) {
      if (err instanceof InvalidTransitionError) {
        return reply.code(422).send({
          error: 'Invalid state transition',
          message: err.message,
          from: err.from,
          to: err.to,
        });
      }
      throw err;
    }
  });

  /**
   * Edit receipt data and transition to reviewed.
   * Only allowed when status is 'extracted'.
   */
  app.put('/receipts/:id', async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const body = updateReceiptSchema.parse(request.body);
    const userId = request.userId!;

    try {
      await repo.updateReviewedData(params.id, userId, {
        merchantName: body.merchantName,
        merchantAddress: body.merchantAddress ?? null,
        lineItems: body.lineItems,
      });

      // Log audit
      await receiptStateService.logEvent(params.id, 'state_changed', {
        from: 'extracted',
        to: 'reviewed',
        editedFields: ['merchantName', 'lineItems'],
        userId,
      });

      const updated = await receiptService.getReceiptById(params.id, userId);
      return reply.code(200).send(updated);
    } catch (err: any) {
      if (err.message?.includes('Cannot edit') || err.message?.includes('Access denied')) {
        return reply.code(422).send({ error: err.message });
      }
      if (err.message?.includes('total')) {
        return reply.code(400).send({ error: 'Validation failed', message: err.message });
      }
      throw err;
    }
  });
}
