# Gojo — Receipt-to-Invoice System Architecture

---

## 1. Tech Stack Decision

| Layer | Choice | Justification |
|-------|--------|---------------|
| **Mobile** | React Native (Expo managed) | Camera API via `expo-camera`, OTA updates, no native build headaches for an image-capture + form app. Eject only if needed later. |
| **OCR** | OpenAI GPT-4o Vision API (backend) | Send receipt image to GPT-4o with a structured extraction prompt. Superior to traditional OCR (Tesseract, Google Vision) for messy thermal receipts — handles skew, fading, multilingual text, and returns structured JSON directly. No on-device ML model maintenance. |
| **PDF Generation** | Server-side with Puppeteer (headless Chromium) | Render an HTML/CSS invoice template → PDF. Pixel-perfect control, supports logos, tables, custom branding. Runs on backend only. |
| **Email** | Resend | Simple API, generous free tier, excellent deliverability, first-class support for attachments (the PDF). |
| **Backend** | Node.js (Fastify) + PostgreSQL + Redis | Fastify for speed and schema validation. Postgres for relational invoice data. Redis for job queue (BullMQ) to handle async OCR + PDF + email pipeline. |
| **Storage** | AWS S3 (or R2) | Receipt images and generated PDFs. Pre-signed URLs for upload from mobile. |
| **Auth** | Clerk | Hosted auth, JWT-based, React Native SDK, zero custom auth code. |

---

## 2. System Architecture (Textual Diagram)

```
┌─────────────────────────────────────────────────────────────────┐
│                        MOBILE APP (Expo)                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│  │  Camera  │→ │ Image Upload │→ │ Invoice Review/Edit Form  │ │
│  └──────────┘  │ (S3 presign) │  └───────────────────────────┘ │
│                └──────────────┘                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS (JWT auth)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     BACKEND (Fastify + BullMQ)                   │
│                                                                  │
│  /upload-receipt-image  → Returns S3 pre-signed URL             │
│  /process-ocr           → Enqueues OCR job → GPT-4o Vision     │
│  /generate-invoice      → Renders HTML template → Puppeteer PDF │
│  /send-email            → Attaches PDF → Resend API             │
│                                                                  │
│  ┌────────┐  ┌───────────┐  ┌──────────┐  ┌────────┐          │
│  │ Router │→ │ Job Queue │→ │ Workers  │→ │ Storage│          │
│  └────────┘  │  (Redis)  │  │(BullMQ)  │  │(S3/PG) │          │
│              └───────────┘  └──────────┘  └────────┘           │
└─────────────────────────────────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         PostgreSQL     AWS S3         Resend
         (data)        (files)        (email)
```

### Mobile App Responsibilities
- Capture receipt photo (camera or gallery)
- Upload image to S3 via pre-signed URL
- Display extracted receipt data for user review/edit
- Allow user to add/select customer details
- Trigger invoice generation and email send
- Show job status (polling or WebSocket)

### Backend Responsibilities
- Authenticate requests (verify Clerk JWT)
- Generate S3 pre-signed upload URLs
- Orchestrate async pipeline: OCR → store → PDF → email
- Persist all domain entities (receipts, invoices, customers)
- Retry failed jobs with exponential backoff

---

## 3. Core Domain Data Model (JSON Schema)

### Receipt

```json
{
  "$id": "Receipt",
  "type": "object",
  "required": ["id", "userId", "imageUrl", "status", "createdAt"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "userId": { "type": "string" },
    "imageUrl": { "type": "string", "format": "uri" },
    "merchantName": { "type": "string" },
    "merchantAddress": { "type": "string" },
    "date": { "type": "string", "format": "date" },
    "subtotal": { "type": "number" },
    "taxAmount": { "type": "number" },
    "totalAmount": { "type": "number" },
    "currency": { "type": "string", "default": "USD", "pattern": "^[A-Z]{3}$" },
    "lineItems": { "type": "array", "items": { "$ref": "LineItem" } },
    "status": { "type": "string", "enum": ["uploaded", "processing", "extracted", "failed"] },
    "rawOcrResponse": { "type": "object" },
    "createdAt": { "type": "string", "format": "date-time" }
  }
}
```

### LineItem

```json
{
  "$id": "LineItem",
  "type": "object",
  "required": ["description", "quantity", "unitPrice", "total"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "description": { "type": "string" },
    "quantity": { "type": "number", "minimum": 0 },
    "unitPrice": { "type": "number", "minimum": 0 },
    "total": { "type": "number", "minimum": 0 }
  }
}
```

### Customer

```json
{
  "$id": "Customer",
  "type": "object",
  "required": ["id", "userId", "name", "email"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "userId": { "type": "string" },
    "name": { "type": "string" },
    "email": { "type": "string", "format": "email" },
    "company": { "type": "string" },
    "address": { "type": "string" },
    "phone": { "type": "string" },
    "createdAt": { "type": "string", "format": "date-time" }
  }
}
```

### Invoice

```json
{
  "$id": "Invoice",
  "type": "object",
  "required": ["id", "userId", "receiptId", "customerId", "invoiceNumber", "status", "createdAt"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "userId": { "type": "string" },
    "receiptId": { "type": "string", "format": "uuid" },
    "customerId": { "type": "string", "format": "uuid" },
    "invoiceNumber": { "type": "string", "pattern": "^INV-[0-9]{6}$" },
    "issueDate": { "type": "string", "format": "date" },
    "dueDate": { "type": "string", "format": "date" },
    "lineItems": { "type": "array", "items": { "$ref": "LineItem" } },
    "subtotal": { "type": "number" },
    "taxRate": { "type": "number" },
    "taxAmount": { "type": "number" },
    "totalAmount": { "type": "number" },
    "currency": { "type": "string", "pattern": "^[A-Z]{3}$" },
    "notes": { "type": "string" },
    "pdfUrl": { "type": "string", "format": "uri" },
    "status": { "type": "string", "enum": ["draft", "generating_pdf", "ready", "sent", "failed"] },
    "sentAt": { "type": "string", "format": "date-time" },
    "createdAt": { "type": "string", "format": "date-time" }
  }
}
```

---

## 4. API Contract

### `POST /upload-receipt-image`

**Request:**
```json
{
  "fileName": "receipt_001.jpg",
  "contentType": "image/jpeg"
}
```

**Response (200):**
```json
{
  "receiptId": "a1b2c3d4-...",
  "uploadUrl": "https://s3.amazonaws.com/bucket/...?X-Amz-Signature=...",
  "imageKey": "receipts/user123/a1b2c3d4.jpg"
}
```

---

### `POST /process-ocr`

**Request:**
```json
{
  "receiptId": "a1b2c3d4-..."
}
```

**Response (202):**
```json
{
  "jobId": "job-5678",
  "status": "processing"
}
```

**Webhook/Poll Response (200) — `GET /receipts/:receiptId`:**
```json
{
  "receiptId": "a1b2c3d4-...",
  "status": "extracted",
  "data": {
    "merchantName": "Costco Wholesale",
    "date": "2026-05-14",
    "lineItems": [
      { "description": "Kirkland Water 40pk", "quantity": 2, "unitPrice": 4.99, "total": 9.98 },
      { "description": "Organic Bananas", "quantity": 1, "unitPrice": 1.99, "total": 1.99 }
    ],
    "subtotal": 11.97,
    "taxAmount": 0.96,
    "totalAmount": 12.93,
    "currency": "USD"
  },
  "confidence": 0.92
}
```

---

### `POST /generate-invoice`

**Request:**
```json
{
  "receiptId": "a1b2c3d4-...",
  "customerId": "cust-9012",
  "dueDate": "2026-06-14",
  "notes": "Payment due within 30 days",
  "lineItems": [
    { "description": "Kirkland Water 40pk", "quantity": 2, "unitPrice": 4.99, "total": 9.98 }
  ],
  "taxRate": 8.0
}
```

**Response (202):**
```json
{
  "invoiceId": "inv-3456",
  "invoiceNumber": "INV-000042",
  "status": "generating_pdf"
}
```

**Poll Response — `GET /invoices/:invoiceId`:**
```json
{
  "invoiceId": "inv-3456",
  "status": "ready",
  "pdfUrl": "https://s3.amazonaws.com/bucket/invoices/inv-3456.pdf"
}
```

---

### `POST /send-email`

**Request:**
```json
{
  "invoiceId": "inv-3456",
  "to": "client@company.com",
  "subject": "Invoice INV-000042 from Arinze",
  "body": "Please find attached your invoice. Payment is due by June 14, 2026."
}
```

**Response (200):**
```json
{
  "emailId": "email-7890",
  "status": "sent",
  "sentAt": "2026-05-16T10:30:00Z"
}
```

---

## 5. OCR Strategy

### Pipeline: Image → Structured JSON

1. **Pre-processing (backend):** Validate image (file size ≤ 10MB, JPEG/PNG/HEIC). Convert HEIC → JPEG if needed. No other manipulation — GPT-4o handles skew/noise natively.

2. **Extraction:** Send image to GPT-4o Vision with this system prompt structure:
   > "Extract all data from this receipt image. Return JSON with: merchantName, merchantAddress, date (ISO 8601), lineItems (array of {description, quantity, unitPrice, total}), subtotal, taxAmount, totalAmount, currency. If a field is unreadable, set it to null. Never hallucinate values."

3. **Validation:** Parse the response against the Receipt JSON schema. Compute checksums (do line item totals sum to subtotal? subtotal + tax = total?). Assign a confidence score (0-1) based on how many fields are non-null and checksums pass.

4. **Human review:** Always present extracted data to the user in the app for confirmation/editing before invoice generation. This is non-negotiable — OCR is never 100%.

### Fallback Strategy

| Condition | Action |
|-----------|--------|
| GPT-4o returns malformed JSON | Retry once with stricter prompt ("respond ONLY with valid JSON") |
| Confidence < 0.5 (too many nulls) | Mark as `failed`, show user a manual entry form pre-filled with whatever was extracted |
| GPT-4o API timeout/5xx | Retry 2x with exponential backoff (2s, 8s). If still failing, queue for retry in 5 min via BullMQ delayed job |
| Image is blank/corrupt | Detect via file header validation. Reject immediately with clear error to user |

---

## 6. Security + Failure Handling

### Security

| Concern | Approach |
|---------|----------|
| **Auth** | Every API call requires valid Clerk JWT in `Authorization: Bearer` header. Backend verifies signature + expiry on every request. |
| **Image upload** | Pre-signed S3 URLs expire in 5 minutes. Scoped to specific key + content type. No direct bucket access. |
| **Data isolation** | Every DB query includes `WHERE userId = ?`. No endpoint ever returns another user's data. |
| **PDF URLs** | Generated PDFs use pre-signed S3 URLs with 24-hour expiry. Never permanent public URLs. |
| **Input validation** | Fastify schema validation on every endpoint. Reject malformed requests at the router level before any business logic. |
| **Rate limiting** | 20 OCR requests/user/hour (GPT-4o is expensive). 100 general requests/user/minute. Enforced via Redis sliding window. |
| **Secrets** | All API keys (OpenAI, Resend, AWS) in environment variables. Never in client bundle. |

### Failure Handling

| Failure Mode | Response |
|--------------|----------|
| **OCR job fails** | BullMQ retries 3x with backoff. After 3 failures, mark receipt as `failed`, notify user via push notification. User can retry or enter manually. |
| **PDF generation fails** | Retry 2x. If Puppeteer crashes, restart worker process. Timeout at 30s per PDF. |
| **Email send fails** | Retry 3x over 15 minutes. If permanently rejected (invalid email), mark invoice as `ready` (PDF exists) and notify user that email bounced. |
| **S3 upload fails** | Client retries upload 2x. If still failing, show user an error with "Try Again" button. |
| **Database unavailable** | Return 503 to client. App shows offline state. No writes attempted — prevent data corruption. |
| **OpenAI rate limit (429)** | Respect `Retry-After` header. Queue job as delayed in BullMQ. User sees "processing" state until complete. |

### Idempotency

- `/process-ocr` is idempotent: calling it twice with same `receiptId` returns existing job if already processing/complete.
- `/send-email` is NOT idempotent by design — user might intentionally re-send. But we track send history and warn on duplicate sends in the app.

---

*This document is the single source of truth for implementation. No redesign needed — start building.*
