#!/bin/bash
# Gojo API smoke test
BASE="http://localhost:3000"
AUTH="Authorization: Bearer dev-test-token"
CT="Content-Type: application/json"

echo ""
echo "━━━ 1. Health Check ━━━"
curl -s "$BASE/health"
echo ""

echo ""
echo "━━━ 2. Missing Auth → 401 ━━━"
curl -s "$BASE/api/v1/receipts/00000000-0000-0000-0000-000000000001"
echo ""

echo ""
echo "━━━ 3. Invalid Content Type → 400 ━━━"
curl -s -X POST "$BASE/api/v1/upload-receipt-image" \
  -H "$AUTH" -H "$CT" \
  -d '{"fileName":"receipt.bmp","contentType":"image/bmp"}'
echo ""

echo ""
echo "━━━ 4. Upload Receipt Image ━━━"
UPLOAD=$(curl -s -X POST "$BASE/api/v1/upload-receipt-image" \
  -H "$AUTH" -H "$CT" \
  -d '{"fileName":"receipt_001.jpg","contentType":"image/jpeg"}')
echo "$UPLOAD"
RECEIPT_ID=$(echo "$UPLOAD" | grep -o '"receiptId":"[^"]*"' | cut -d'"' -f4)
echo "  → receiptId: $RECEIPT_ID"

echo ""
echo "━━━ 5. Get Receipt ━━━"
curl -s "$BASE/api/v1/receipts/$RECEIPT_ID" -H "$AUTH"
echo ""

echo ""
echo "━━━ 6. Process OCR ━━━"
curl -s -X POST "$BASE/api/v1/process-ocr" \
  -H "$AUTH" -H "$CT" \
  -d "{\"receiptId\":\"$RECEIPT_ID\"}"
echo ""

echo ""
echo "━━━ 7. Generate Invoice ━━━"
INVOICE=$(curl -s -X POST "$BASE/api/v1/generate-invoice" \
  -H "$AUTH" -H "$CT" \
  -d "{\"receiptId\":\"$RECEIPT_ID\",\"customerId\":\"00000000-0000-0000-0000-000000000001\",\"dueDate\":\"2026-06-16\",\"notes\":\"Net 30\",\"lineItems\":[{\"description\":\"Kirkland Water 40pk\",\"quantity\":2,\"unitPrice\":4.99,\"total\":9.98},{\"description\":\"Organic Bananas\",\"quantity\":1,\"unitPrice\":1.99,\"total\":1.99}],\"taxRate\":8.0}")
echo "$INVOICE"
INVOICE_ID=$(echo "$INVOICE" | grep -o '"invoiceId":"[^"]*"' | cut -d'"' -f4)
echo "  → invoiceId: $INVOICE_ID"

echo ""
echo "━━━ 8. Get Invoice ━━━"
curl -s "$BASE/api/v1/invoices/$INVOICE_ID" -H "$AUTH"
echo ""

echo ""
echo "━━━ 9. Send Email (will fail — invoice not 'ready') ━━━"
curl -s -X POST "$BASE/api/v1/send-email" \
  -H "$AUTH" -H "$CT" \
  -d "{\"invoiceId\":\"$INVOICE_ID\",\"to\":\"client@example.com\",\"subject\":\"Invoice from Gojo\",\"body\":\"Please find your invoice attached.\"}"
echo ""

echo ""
echo "━━━ All tests complete ━━━"
