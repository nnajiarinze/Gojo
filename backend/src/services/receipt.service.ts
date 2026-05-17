import * as repo from '../repositories/receipt.repository.js';
import { Receipt } from '../types/domain.js';

export async function createUploadUrl(
  userId: string,
  fileName: string,
  contentType: string
): Promise<{ receiptId: string; uploadUrl: string; imageKey: string }> {
  const imageKey = `receipts/${userId}/${Date.now()}-${fileName}`;
  // TODO: Replace with real S3 pre-signed URL generation
  const uploadUrl = `https://s3.amazonaws.com/gojo-receipts/${imageKey}?X-Amz-Signature=stub`;

  const receiptId = await repo.createReceipt(userId, uploadUrl, imageKey);

  return { receiptId, uploadUrl, imageKey };
}

export async function getReceiptById(
  receiptId: string,
  userId: string
): Promise<Receipt | null> {
  return repo.getReceiptById(receiptId, userId);
}
