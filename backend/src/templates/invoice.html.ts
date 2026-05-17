/**
 * Canonical invoice HTML template — single source of truth for PDF rendering.
 * Ported from mobile/src/services/invoicePdf.ts and owned by the backend.
 */
import type { Invoice } from '../types/domain.js';

function formatSEK(n: number): string {
  return n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildInvoiceHtml(invoice: Invoice): string {
  const lineItemsHtml = invoice.lineItems
    .map(
      (li) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;">${escapeHtml(li.description)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center;">${li.quantity}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right;">${formatSEK(li.unitPrice)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right;">${formatSEK(li.total)}</td>
      </tr>`
    )
    .join('\n');

  const legal = invoice.legalMetadata;
  const issueDate = typeof invoice.issueDate === 'string'
    ? invoice.issueDate
    : new Date().toISOString().split('T')[0];

  return `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Faktura ${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color:#111827; padding:40px; font-size:13px; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:32px; }
    .brand { font-size:28px; font-weight:800; color:#7C3AED; }
    .invoice-label { font-size:10px; letter-spacing:2px; color:#9CA3AF; font-weight:700; text-transform:uppercase; }
    .invoice-number { font-size:22px; font-weight:800; font-family:monospace; margin-top:2px; }
    .meta-grid { display:flex; gap:32px; margin-bottom:24px; }
    .meta-box h4 { font-size:10px; letter-spacing:1px; color:#9CA3AF; font-weight:700; text-transform:uppercase; margin-bottom:4px; }
    .meta-box p { font-size:13px; color:#374151; }
    table { width:100%; border-collapse:collapse; margin-bottom:24px; }
    thead th { font-size:10px; letter-spacing:1px; color:#9CA3AF; font-weight:700; text-transform:uppercase; padding:8px 12px; border-bottom:2px solid #E5E7EB; text-align:left; }
    thead th.right { text-align:right; }
    thead th.center { text-align:center; }
    .totals { margin-left:auto; width:280px; }
    .totals .row { display:flex; justify-content:space-between; padding:6px 0; font-size:14px; }
    .totals .row.grand { border-top:2px solid #111827; margin-top:8px; padding-top:12px; font-size:18px; font-weight:700; }
    .totals .row.grand .val { color:#7C3AED; }
    .legal { margin-top:32px; padding-top:16px; border-top:1px solid #E5E7EB; font-size:11px; color:#6B7280; }
    .legal strong { color:#374151; }
    .footer { margin-top:24px; text-align:center; font-size:10px; color:#9CA3AF; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">Gojo</div>
      ${legal?.companyName ? `<div style="font-size:13px;color:#6B7280;margin-top:2px;">${escapeHtml(legal.companyName)}</div>` : ''}
      ${legal?.address ? `<div style="font-size:12px;color:#9CA3AF;">${escapeHtml(legal.address)}</div>` : ''}
    </div>
    <div style="text-align:right;">
      <div class="invoice-label">Faktura</div>
      <div class="invoice-number">${escapeHtml(invoice.invoiceNumber)}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-box">
      <h4>Fakturadatum</h4>
      <p>${issueDate}</p>
    </div>
    <div class="meta-box">
      <h4>Förfallodatum</h4>
      <p>${invoice.dueDate}</p>
    </div>
    <div class="meta-box">
      <h4>Valuta</h4>
      <p>${invoice.currency}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Beskrivning</th>
        <th class="center">Antal</th>
        <th class="right">À-pris</th>
        <th class="right">Belopp</th>
      </tr>
    </thead>
    <tbody>
      ${lineItemsHtml}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Netto</span><span>${invoice.currency} ${formatSEK(invoice.subtotal)}</span></div>
    <div class="row"><span>Moms (${invoice.taxRate}%)</span><span>${invoice.currency} ${formatSEK(invoice.taxAmount)}</span></div>
    <div class="row grand"><span>Totalt</span><span class="val">${invoice.currency} ${formatSEK(invoice.totalAmount)}</span></div>
  </div>

  ${invoice.notes ? `<div style="margin-top:16px;padding:12px;background:#F9FAFB;border-radius:8px;font-size:12px;color:#374151;"><strong>Anteckningar:</strong> ${escapeHtml(invoice.notes)}</div>` : ''}

  <div class="legal">
    <strong>JURIDISK INFORMATION</strong><br/>
    ${legal?.companyName ? `Företag: ${escapeHtml(legal.companyName)}<br/>` : ''}
    ${legal?.orgNumber ? `Organisationsnummer: ${escapeHtml(legal.orgNumber)}<br/>` : ''}
    ${legal?.kontrollenhet ? `Kontrollenhet: ${escapeHtml(legal.kontrollenhet)}<br/>` : ''}
    ${legal?.address ? `Adress: ${escapeHtml(legal.address)}<br/>` : ''}
  </div>

  <div class="footer">
    Genererad av Gojo · ${issueDate}
  </div>
</body>
</html>`;
}
