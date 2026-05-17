import { z } from 'zod';

export const uploadReceiptSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/heic']),
});

export const processOcrSchema = z.object({
  receiptId: z.string().uuid(),
});

export const generateInvoiceSchema = z.object({
  receiptId: z.string().uuid(),
  customerId: z.string().uuid(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
  lineItems: z.array(z.object({
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
    total: z.number().min(0),
  })).min(1),
  taxRate: z.number().min(0).max(100),
  taxAmount: z.number().min(0).optional(),
  subtotal: z.number().min(0).optional(),
  totalAmount: z.number().min(0).optional(),
  legal: z.object({
    kontrollenhet: z.string(),
    orgNumber: z.string(),
    companyName: z.string(),
    address: z.string(),
  }).optional(),
});

export const sendEmailSchema = z.object({
  invoiceId: z.string().uuid(),
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const updateReceiptSchema = z.object({
  merchantName: z.string().min(1),
  merchantAddress: z.string().optional().nullable(),
  lineItems: z.array(z.object({
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
    total: z.number().min(0),
  })).min(1),
});
