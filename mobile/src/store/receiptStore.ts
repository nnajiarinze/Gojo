import { create } from 'zustand';
import type { Receipt, Invoice, InvoiceCreatedResponse } from '../types/api';
import type { OCRResult } from '../services/ocrService';
import type { ParsedReceipt, ParseResult } from '../services/receiptParser';
import type { ReceiptImage } from '../services/receiptImage';

export type FlowStep = 'idle' | 'capturing' | 'uploading' | 'processing' | 'done' | 'error';
export type ParserMode = 'gojo' | 'generic';

interface ReceiptState {
  step: FlowStep;
  parserMode: ParserMode;
  error: string | null;
  imageUri: string | null;
  receiptImage: ReceiptImage | null;
  receiptId: string | null;
  receipt: Receipt | null;
  invoiceCreated: InvoiceCreatedResponse | null;
  invoice: Invoice | null;
  localOcr: OCRResult | null;
  parsedReceipt: ParsedReceipt | null;
  parseResult: ParseResult | null;

  setImageUri: (uri: string) => void;
  setReceiptImage: (image: ReceiptImage) => void;
  setReceiptId: (id: string) => void;
  setReceipt: (receipt: Receipt) => void;
  setInvoiceCreated: (data: InvoiceCreatedResponse) => void;
  setInvoice: (invoice: Invoice) => void;
  setLocalOcr: (result: OCRResult) => void;
  setParsedReceipt: (parsed: ParsedReceipt) => void;
  setParseResult: (result: ParseResult) => void;
  setParserMode: (mode: ParserMode) => void;
  setStep: (step: FlowStep) => void;
  setError: (error: string) => void;
  reset: () => void;
}

const initialState = {
  step: 'idle' as FlowStep,
  parserMode: 'generic' as ParserMode,
  error: null as string | null,
  imageUri: null as string | null,
  receiptImage: null as ReceiptImage | null,
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

  setImageUri: (uri) => set({
    imageUri: uri,
    receiptImage: { uri, width: 0, height: 0, source: 'camera' },
    step: 'capturing',
    error: null,
    receiptId: null,
    receipt: null,
    invoiceCreated: null,
    invoice: null,
    localOcr: null,
    parsedReceipt: null,
    parseResult: null,
  }),
  setReceiptImage: (image) => set({
    imageUri: image.uri,
    receiptImage: image,
    step: 'capturing',
    error: null,
    receiptId: null,
    receipt: null,
    invoiceCreated: null,
    invoice: null,
    localOcr: null,
    parsedReceipt: null,
    parseResult: null,
  }),
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
  setParserMode: (mode) => set({ parserMode: mode }),
  setStep: (step) => set({ step }),
  setError: (error) => set({ error, step: 'error' }),
  reset: () => set((state) => ({ ...initialState, parserMode: state.parserMode })),
}));