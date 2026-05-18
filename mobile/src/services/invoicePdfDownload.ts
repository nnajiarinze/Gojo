/**
 * Invoice PDF service — downloads stored PDF from backend and opens share sheet.
 * PDFs are generated and stored server-side; mobile only downloads/shares them.
 */
import { downloadAsync, cacheDirectory } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { Invoice } from '../types/api';
import { config } from '../config/env';

/**
 * Download the stored invoice PDF from the backend and open the share sheet.
 * Returns the local file URI on success.
 */
export async function downloadAndShareInvoicePdf(invoice: Invoice): Promise<string> {
  const legacyStatus = invoice.status as string | undefined;
  const pdfStatus = invoice.pdfStatus ?? (legacyStatus === 'sent' ? 'ready' : legacyStatus);
  console.log('[PDF] ═══ DOWNLOADING PDF ═══');
  console.log(`[PDF] Invoice: ${invoice.invoiceNumber}, pdfStatus: ${pdfStatus}`);

  if (pdfStatus === 'generating_pdf') {
    throw new Error('PDF håller på att genereras. Försök igen om en stund.');
  }

  // Download PDF from backend endpoint (redirects to Supabase Storage)
  const url = `${config.API_BASE_URL}/invoices/${invoice.id}/pdf`;
  const localUri = `${cacheDirectory}${invoice.invoiceNumber}.pdf`;

  console.log(`[PDF] Downloading from: ${url}`);

  const result = await downloadAsync(url, localUri, {
    headers: {
      Authorization: `Bearer ${config.AUTH_TOKEN}`,
    },
  });

  if (result.status !== 200) {
    throw new Error(`PDF-nedladdning misslyckades (status ${result.status})`);
  }

  console.log(`[PDF] Downloaded to: ${result.uri}`);

  // Open share sheet
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(result.uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Faktura ${invoice.invoiceNumber}`,
      UTI: 'com.adobe.pdf',
    });
    console.log('[PDF] Share sheet opened');
  } else {
    console.warn('[PDF] Sharing not available on this device');
  }

  console.log('[PDF] ═══════════════════════');
  return result.uri;
}
