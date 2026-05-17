import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getReceipt } from '../api/receipts';
import { useReceiptStore } from '../store/receiptStore';
import type { Receipt, ReceiptStatus } from '../types/api';

const TERMINAL_STATUSES: ReceiptStatus[] = ['invoiced', 'failed'];
const ACTIONABLE_STATUSES: ReceiptStatus[] = ['extracted', 'reviewed', 'invoice_ready', 'invoiced'];

/**
 * Polls GET /receipts/:id every 2.5s.
 * Stops when status reaches an actionable or terminal state.
 */
export function useReceiptPolling(receiptId: string | null) {
  const setReceipt = useReceiptStore((s) => s.setReceipt);
  const setStep = useReceiptStore((s) => s.setStep);
  const setError = useReceiptStore((s) => s.setError);

  const query = useQuery<Receipt>({
    queryKey: ['receipt', receiptId],
    queryFn: async () => {
      const data = await getReceipt(receiptId!);
      console.log(`[Polling] Receipt ${receiptId} -> status: ${data.status}`);
      return data;
    },
    enabled: !!receiptId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2500;
      if (TERMINAL_STATUSES.includes(data.status)) return false;
      if (ACTIONABLE_STATUSES.includes(data.status)) return false;
      return 2500;
    },
    retry: 3,
  });

  // Polling updates store state ONLY — never navigates.
  // It sets step='done' explicitly so processing.tsx can detect the
  // transition from 'processing' → 'done' (not stale 'done' on remount).
  useEffect(() => {
    const data = query.data;
    if (!data) return;

    console.log(`[Polling Effect] Status -> ${data.status}, current step: ${useReceiptStore.getState().step}`);

    if (data.status === 'failed') {
      console.log('[Polling] Setting error state');
      setError('Processing failed. Please try again.');
    } else if (ACTIONABLE_STATUSES.includes(data.status)) {
      // Update receipt data AND mark step as done so processing screen
      // can detect the transition and navigate once.
      console.log(`[Polling] Receipt actionable (${data.status}), setting receipt + step=done`);
      setReceipt(data);
      setStep('done');
    } else {
      setStep('processing');
    }
  }, [query.data?.status]);

  return query;
}
