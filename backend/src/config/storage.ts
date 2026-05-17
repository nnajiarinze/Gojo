/**
 * PDF storage using Supabase Storage.
 * Uploads generated PDFs and returns public URLs.
 */
import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

const BUCKET = 'invoices';

function getClient() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required for PDF storage');
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}

/**
 * Ensure the invoices bucket exists (called once at startup).
 */
export async function ensureBucket(): Promise<void> {
  const supabase = getClient();
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (error && !error.message?.includes('already exists')) {
      throw error;
    }
    console.log(`[Storage] Created bucket: ${BUCKET}`);
  } else {
    console.log(`[Storage] Bucket exists: ${BUCKET}`);
  }
}

/**
 * Upload a PDF buffer to Supabase Storage.
 * Returns the public URL.
 */
export async function uploadPdf(invoiceId: string, pdfBuffer: Buffer): Promise<string> {
  const supabase = getClient();
  const path = `${invoiceId}.pdf`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) {
    throw new Error(`PDF upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  console.log(`[Storage] Uploaded ${path} (${pdfBuffer.length} bytes) → ${data.publicUrl}`);
  return data.publicUrl;
}
