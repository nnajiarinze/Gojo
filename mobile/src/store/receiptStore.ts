import { create } from 'zustand';
import type { Receipt, Invoice, InvoiceCreatedResponse } from '../types/api';
import type { OCRResult } from '../services/ocrService';
import type { ParsedReceipt, ParseResult } from '../services/receiptParser';

export type FlowStep = 'idle' | 'capturing' | 'uploading' | 'processing' | 'done' | 'error';

interface ReceiptState {
  step: FlowStep;
  error: string | null;
  imageUri: string | null;
  receiptId: string | null;
  receipt: Receipt | null;
  invoiceCreated: InvoiceCreatedResponse | null;
  invoice: Invoice | null;
  localOcr: OCRResult | null;
  parsedReceipt: ParsedReceipt | null;
  parseResult: ParseResult | null;

  setImageUri: (uri: string) => void;
  setReceiptId: (id: string) => void;
  setReceipt: (receipt: Receipt) => void;
  setInvoiceCreated: (data: InvoiceCreatedResponse) => void;
  setInvoice: (invoice: Invoice) => void;
  setLocalOcr: (result: OCRResult) => void;
  setParsedReceipt: (parsed: ParsedReceipt) => void;
  setParseResult: (result: ParseResult) => void;
  setStep: (step: FlowStep) => void;
  setError: (error: string) => void;
  reset: () => void;
}

const initialState = {
  step: 'idle' as FlowStep,
  error: null as string | null,
  imageUri: null as string | null,
  receiptId: null as string | null,
  receipt: null as Receipt | null,
  invoiceCreated: null as InvoiceCreatedResponse | null,
  invoice: null as Invoice | null,
  localOcr: null as OCRResult | null,
  parsedReceipt: null as ParsedReceipt | null,
  parseResult: null as ParseResult | null,
};

export const useReceiptStore = create<ReceiptState>((set) => ({
  ...initialState,

  setImageUri: (uri) => set({ imageUri: uri, step: 'capturing' }),
  setReceiptId: (id) => set({ receiptId: id }),
  // FIX: setReceipt MUST NOT change step. The old code set step='done' on
  // every call, which meant navigating back to the processing screen would
  // find step='done' already set, and the useEffect would immediately push
  // forward to /result — creating an infinite navigation loop.
  // Now step is only set to 'done' explicitly by useReceiptPolling.
  setReceipt: (receipt) => set({ receipt }),
  setInvoiceCreated: (data) => set({ invoiceCreated: data }),
  setInvoice: (invoice) => set({ invoice }),
  setLocalOcr: (result) => set({ localOcr: result }),
  setParsedReceipt: (parsed) => set({ parsedReceipt: parsed }),
  setParseResult: (result) => set({ parseResult: result }),
  setStep: (step) => set({ step }),
  setError: (error) => set({ error, step: 'error' }),
  reset: () => set(initialState),
}));