import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';
import { query, queryOne } from '../config/database.js';
import * as emailService from '../services/email.service.js';
import { generateAndStoreInvoicePdf } from '../services/invoice-pdf.service.js';

type AdminPaymentStatus = 'unpaid' | 'paid';

// ─── Token guard ────────────────────────────────────────────────────────────

async function requireAdminToken(request: FastifyRequest, reply: FastifyReply) {
  const token = request.headers['x-admin-token'];
  if (!token || token !== env.ADMIN_TOKEN) {
    return reply.code(401).send({ error: 'Invalid or missing admin token' });
  }
}

const guardedRoute = { preHandler: requireAdminToken };

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseInvoiceRow(row: any) {
  const pdfStatus = normalizePdfStatus(row.pdf_status ?? row.status);
  const emailStatus = normalizeEmailStatus(row.email_status ?? (row.status === 'sent' || row.sent_at ? 'sent' : 'pending'));
  const paymentStatus = normalizePaymentStatus(row.payment_status ?? 'unpaid');
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name ?? null,
    organizationSlug: row.organization_slug ?? null,
    receiptId: row.receipt_id,
    customerId: row.customer_id,
    invoiceNumber: row.invoice_number,
    issueDate: row.issue_date instanceof Date ? row.issue_date.toISOString().split('T')[0] : String(row.issue_date),
    dueDate: row.due_date instanceof Date ? row.due_date.toISOString().split('T')[0] : String(row.due_date),
    subtotal: parseFloat(row.subtotal),
    taxRate: parseFloat(row.tax_rate),
    taxAmount: parseFloat(row.tax_amount),
    totalAmount: parseFloat(row.total_amount),
    currency: row.currency?.trim() ?? 'SEK',
    notes: row.notes,
    pdfUrl: row.pdf_url,
    pdfStatus,
    emailStatus,
    paymentStatus,
    status: pdfStatus,
    legalMetadata: row.legal_metadata ?? null,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizePdfStatus(value: string | null | undefined) {
  if (value === 'sent') return 'ready';
  if (value === 'draft' || value === 'generating_pdf' || value === 'ready' || value === 'failed') return value;
  return 'draft';
}

function normalizeEmailStatus(value: string | null | undefined) {
  if (value === 'pending' || value === 'sending' || value === 'sent' || value === 'failed') return value;
  return 'pending';
}

function normalizePaymentStatus(value: string | null | undefined) {
  if (value === 'paid' || value === 'partially_paid' || value === 'overdue') return value;
  return 'unpaid';
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Serve admin SPA (no token required — token is sent via JS fetch calls)
  app.get('/ui', async (_request, reply) => {
    return reply.type('text/html').send(ADMIN_HTML);
  });

  // ── List organizations for super-admin filtering ──────────────────────
  app.get('/organizations', { ...guardedRoute }, async (_request, reply) => {
    const organizations = await query<any>(
      `SELECT id, name, slug, org_number, address, created_at, updated_at
       FROM organizations
       ORDER BY name ASC`
    );

    return reply.send({
      organizations: organizations.map((org: any) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        orgNumber: org.org_number,
        address: org.address,
        createdAt: org.created_at,
        updatedAt: org.updated_at,
      })),
    });
  });

  // ── List invoices (paginated) ───────────────────────────────────────────
  app.get('/invoices', { ...guardedRoute }, async (request, reply) => {
    const { page = '1', limit = '20', organizationId } = request.query as any;
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (p - 1) * l;
    const filterByOrganization = typeof organizationId === 'string' && organizationId !== '' && organizationId !== 'all';

    const countRow = await queryOne<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM invoices i
       ${filterByOrganization ? 'WHERE i.organization_id = $1' : ''}`,
      filterByOrganization ? [organizationId] : []
    );
    const total = parseInt(countRow?.cnt ?? '0', 10);

    const rows = await query<any>(
      `SELECT i.*, o.name AS organization_name, o.slug AS organization_slug
       FROM invoices i
       LEFT JOIN organizations o ON o.id = i.organization_id
       ${filterByOrganization ? 'WHERE i.organization_id = $1' : ''}
       ORDER BY i.created_at DESC
       LIMIT $${filterByOrganization ? 2 : 1} OFFSET $${filterByOrganization ? 3 : 2}`,
      filterByOrganization ? [organizationId, l, offset] : [l, offset]
    );

    const invoices = rows.map(parseInvoiceRow);

    // Attach email event summary per invoice
    for (const inv of invoices) {
      const events = await query<any>(
        `SELECT event, metadata, created_at FROM invoice_events WHERE invoice_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [inv.id]
      );
      (inv as any).emailEvents = events.map((e: any) => ({
        event: e.event,
        metadata: e.metadata,
        createdAt: e.created_at,
      }));
    }

    return reply.send({ invoices, page: p, limit: l, total, totalPages: Math.ceil(total / l), organizationId: filterByOrganization ? organizationId : 'all' });
  });

  // ── Get single invoice detail ───────────────────────────────────────────
  app.get('/invoices/:id', { ...guardedRoute }, async (request, reply) => {
    const { id } = request.params as any;

    const row = await queryOne<any>(
      `SELECT i.*, o.name AS organization_name, o.slug AS organization_slug
       FROM invoices i
       LEFT JOIN organizations o ON o.id = i.organization_id
       WHERE i.id = $1`,
      [id]
    );
    if (!row) return reply.code(404).send({ error: 'Invoice not found' });

    const invoice = parseInvoiceRow(row);

    // Line items
    const liRows = await query<any>(
      'SELECT * FROM line_items WHERE invoice_id = $1 ORDER BY sort_order',
      [id]
    );
    const lineItems = liRows.map((r: any) => ({
      id: r.id,
      description: r.description,
      quantity: parseFloat(r.quantity),
      unitPrice: parseFloat(r.unit_price),
      total: parseFloat(r.total),
      sortOrder: r.sort_order,
    }));

    // All events
    const events = await query<any>(
      'SELECT * FROM invoice_events WHERE invoice_id = $1 ORDER BY created_at DESC',
      [id]
    );
    const emailEvents = events.map((e: any) => ({
      id: e.id,
      event: e.event,
      metadata: e.metadata,
      createdAt: e.created_at,
    }));

    return reply.send({ ...invoice, lineItems, emailEvents });
  });

  // ── Resend email ────────────────────────────────────────────────────────
  app.post('/invoices/:id/resend-email', { ...guardedRoute }, async (request, reply) => {
    const { id } = request.params as any;
    const { to } = (request.body as any) ?? {};

    const row = await queryOne<any>('SELECT * FROM invoices WHERE id = $1', [id]);
    if (!row) return reply.code(404).send({ error: 'Invoice not found' });
    if (!row.pdf_url) return reply.code(400).send({ error: 'No PDF available' });

    const recipientEmail = to || (() => {
      // Try to find last email recipient from events
      const lastSend = undefined; // will query below
      return null;
    })();

    // Find last email recipient if not provided
    let emailTo = to;
    if (!emailTo) {
      const lastEvent = await queryOne<any>(
        `SELECT metadata FROM invoice_events WHERE invoice_id = $1 AND event = 'email_sent' ORDER BY created_at DESC LIMIT 1`,
        [id]
      );
      emailTo = lastEvent?.metadata?.to;
    }

    if (!emailTo) {
      return reply.code(400).send({ error: 'No recipient email provided and no previous send found' });
    }

    try {
      const result = await emailService.sendInvoiceEmail({
        invoiceId: id,
        userId: row.user_id,
        to: emailTo,
        subject: `Faktura ${row.invoice_number}`,
        body: `Bifogat finner du faktura ${row.invoice_number}.`,
      });

      return reply.send({ emailStatus: 'sent', status: 'sent', emailId: result.emailId });
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── Update payment status ──────────────────────────────────────────────
  app.patch('/invoices/:id/payment-status', { ...guardedRoute }, async (request, reply) => {
    const { id } = request.params as any;
    const { paymentStatus } = (request.body as any) ?? {};

    if (paymentStatus !== 'unpaid' && paymentStatus !== 'paid') {
      return reply.code(400).send({ error: 'paymentStatus must be "unpaid" or "paid"' });
    }

    const updated = await queryOne<any>(
      `UPDATE invoices
       SET payment_status = $2::invoice_payment_status
       WHERE id = $1
       RETURNING *`,
      [id, paymentStatus satisfies AdminPaymentStatus]
    );

    if (!updated) return reply.code(404).send({ error: 'Invoice not found' });

    await query(
      `INSERT INTO invoice_events (id, invoice_id, event, metadata)
       VALUES (gen_random_uuid(), $1, 'state_changed', $2)`,
      [id, JSON.stringify({ field: 'paymentStatus', paymentStatus })]
    );

    return reply.send(parseInvoiceRow(updated));
  });

  // ── Regenerate PDF for stuck/failed invoices ──────────────────────────
  app.post('/invoices/:id/regenerate-pdf', { ...guardedRoute }, async (request, reply) => {
    const { id } = request.params as any;

    const row = await queryOne<any>('SELECT * FROM invoices WHERE id = $1', [id]);
    if (!row) return reply.code(404).send({ error: 'Invoice not found' });

    try {
      const pdfUrl = await generateAndStoreInvoicePdf(id, row.user_id);
      const updated = await queryOne<any>(
        `SELECT i.*, o.name AS organization_name, o.slug AS organization_slug
         FROM invoices i
         LEFT JOIN organizations o ON o.id = i.organization_id
         WHERE i.id = $1`,
        [id]
      );
      return reply.send({ ...parseInvoiceRow(updated), pdfUrl });
    } catch (err: any) {
      return reply.code(500).send({ error: err.message ?? 'Failed to regenerate PDF' });
    }
  });
}

// ─── Inline Admin SPA ───────────────────────────────────────────────────────

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gojo Admin</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #1a1a1a; }
  .header { background: #111; color: #fff; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .header .badge { background: #333; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
  .container { max-width: 1100px; margin: 24px auto; padding: 0 16px; }
  .card { background: #fff; border-radius: 8px; border: 1px solid #e0e0e0; padding: 20px; margin-bottom: 16px; }
  .card h2 { font-size: 16px; margin-bottom: 12px; color: #333; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; padding: 10px 12px; background: #fafafa; border-bottom: 2px solid #e0e0e0; font-weight: 600; color: #555; font-size: 12px; text-transform: uppercase; }
  td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; }
  tr:hover td { background: #f8f8ff; }
  tr { cursor: pointer; }
  .status { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .status-ready { background: #d4edda; color: #155724; }
  .status-pending { background: #e2e3e5; color: #383d41; }
  .status-sending { background: #fff3cd; color: #856404; }
  .status-sent { background: #cce5ff; color: #004085; }
  .status-paid { background: #d1fae5; color: #065f46; }
  .status-unpaid { background: #fee2e2; color: #991b1b; }
  .status-failed { background: #f8d7da; color: #721c24; }
  .status-generating_pdf { background: #fff3cd; color: #856404; }
  .status-draft { background: #e2e3e5; color: #383d41; }
  .btn { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
  .btn-primary { background: #111; color: #fff; }
  .btn-primary:hover { background: #333; }
  .btn-muted { background: #f3f4f6; color: #374151; }
  .btn-muted:hover { background: #e5e7eb; }
  .btn-sm { padding: 4px 10px; font-size: 12px; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  .meta-item label { font-size: 11px; text-transform: uppercase; color: #888; font-weight: 600; display: block; margin-bottom: 2px; }
  .meta-item span { font-size: 14px; }
  .json-block { background: #1e1e1e; color: #d4d4d4; padding: 16px; border-radius: 6px; overflow-x: auto; font-family: 'SF Mono', monospace; font-size: 12px; white-space: pre-wrap; max-height: 400px; overflow-y: auto; }
  .back-link { color: #555; text-decoration: none; font-size: 14px; display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px; }
  .back-link:hover { color: #111; }
  .event-row { padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
  .event-name { font-weight: 600; }
  .event-time { color: #888; font-size: 12px; }
  .collapsible { cursor: pointer; user-select: none; }
  .collapsible::before { content: '▶ '; font-size: 11px; }
  .collapsible.open::before { content: '▼ '; }
  input[type=email] { padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; width: 250px; }
  .token-bar { background: #fffbe6; border-bottom: 1px solid #f0e0a0; padding: 8px 24px; display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .token-bar input { padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; width: 240px; }
  .amount { font-variant-numeric: tabular-nums; }
  .empty { text-align: center; padding: 40px; color: #888; }
  .loading { text-align: center; padding: 40px; color: #888; }
  .error { background: #f8d7da; color: #721c24; padding: 12px; border-radius: 6px; margin-bottom: 12px; }
  .pagination { display: flex; gap: 8px; align-items: center; justify-content: center; margin-top: 16px; font-size: 13px; }
  .toolbar { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; }
  .toolbar label { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #666; margin-right: 6px; }
  .toolbar select { padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; min-width: 220px; }
</style>
</head>
<body>
<div class="header">
  <h1>Gojo</h1>
  <span class="badge">Admin</span>
</div>
<div class="token-bar">
  <label>Token:</label>
  <input type="password" id="token-input" placeholder="x-admin-token" />
  <button class="btn btn-sm btn-primary" onclick="saveToken()">Set</button>
  <span id="token-status" style="color:#888"></span>
</div>
<div class="container" id="app">
  <div class="loading">Loading...</div>
</div>

<script>
const BASE = location.origin;
let TOKEN = localStorage.getItem('gojo_admin_token') || '';
let currentView = 'list';
let currentId = null;
let listData = { invoices: [], page: 1, total: 0, totalPages: 0 };
let organizations = [];
let selectedOrganizationId = localStorage.getItem('gojo_admin_organization_id') || 'all';

function saveToken() {
  TOKEN = document.getElementById('token-input').value.trim();
  localStorage.setItem('gojo_admin_token', TOKEN);
  document.getElementById('token-status').textContent = 'Saved ✓';
  loadList(1);
}

document.getElementById('token-input').value = TOKEN;

async function api(path, opts = {}) {
  const res = await fetch(BASE + '/admin' + path, {
    ...opts,
    headers: { 'x-admin-token': TOKEN, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function $(html) { const d = document.createElement('div'); d.innerHTML = html; return d.innerHTML; }

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('sv-SE');
}
function formatAmount(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function humanizeStatus(s) {
  return String(s || '—').replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}

function statusBadge(s) {
  return '<span class="status status-' + (s||'draft') + '">' + humanizeStatus(s||'draft') + '</span>';
}

function paymentControl(inv) {
  const next = inv.paymentStatus === 'paid' ? 'unpaid' : 'paid';
  const label = inv.paymentStatus === 'paid' ? 'Mark unpaid' : 'Mark paid';
  return statusBadge(inv.paymentStatus) + ' <button class="btn btn-sm btn-muted" onclick="event.stopPropagation(); updatePaymentStatus(&apos;' + inv.id + '&apos;, &apos;' + next + '&apos;)">' + label + '</button>';
}

async function loadOrganizations() {
  const data = await api('/organizations');
  organizations = data.organizations || [];
}

function organizationFilterHtml() {
  let html = '<div><label for="org-filter">Organization</label><select id="org-filter" onchange="setOrganizationFilter(this.value)">';
  html += '<option value="all"' + (selectedOrganizationId === 'all' ? ' selected' : '') + '>All organizations</option>';
  for (const org of organizations) {
    html += '<option value="' + org.id + '"' + (selectedOrganizationId === org.id ? ' selected' : '') + '>' + org.name + '</option>';
  }
  html += '</select></div>';
  return html;
}

function setOrganizationFilter(organizationId) {
  selectedOrganizationId = organizationId || 'all';
  localStorage.setItem('gojo_admin_organization_id', selectedOrganizationId);
  loadList(1);
}

// ── List view ─────────────────────────────────────────────────────────────
async function loadList(page = 1) {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading">Loading invoices...</div>';
  try {
    if (!organizations.length) await loadOrganizations();
    listData = await api('/invoices?page=' + page + '&limit=20&organizationId=' + encodeURIComponent(selectedOrganizationId));
    renderList();
  } catch (e) {
    app.innerHTML = '<div class="error">' + e.message + '</div>';
  }
}

function renderList() {
  const { invoices, page, total, totalPages } = listData;
  const app = document.getElementById('app');
  const toolbar = '<div class="toolbar"><h2>Invoices (' + total + ')</h2>' + organizationFilterHtml() + '</div>';
  if (!invoices.length) { app.innerHTML = '<div class="card">' + toolbar + '<div class="empty">No invoices found</div></div>'; return; }

  let html = '<div class="card">' + toolbar + '<table><thead><tr>'
    + '<th>Invoice #</th><th>Organization</th><th>Customer</th><th>Total</th><th>Email Status</th><th>Payment Status</th>'
    + '</tr></thead><tbody>';

  for (const inv of invoices) {
    html += '<tr onclick="loadDetail(&apos;' + inv.id + '&apos;)">'
      + '<td>' + inv.invoiceNumber + '</td>'
      + '<td>' + (inv.organizationName || '—') + '</td>'
      + '<td>' + ((inv.legalMetadata && inv.legalMetadata.companyName) || 'Gojo') + '</td>'
      + '<td class="amount">' + formatAmount(inv.totalAmount) + ' ' + (inv.currency||'SEK') + '</td>'
      + '<td>' + statusBadge(inv.emailStatus) + '</td>'
      + '<td>' + paymentControl(inv) + '</td>'
      + '</tr>';
  }

  html += '</tbody></table>';
  if (totalPages > 1) {
    html += '<div class="pagination">';
    if (page > 1) html += '<button class="btn btn-sm" onclick="loadList(' + (page-1) + ')">← Prev</button>';
    html += '<span>Page ' + page + ' / ' + totalPages + '</span>';
    if (page < totalPages) html += '<button class="btn btn-sm" onclick="loadList(' + (page+1) + ')">Next →</button>';
    html += '</div>';
  }
  html += '</div>';
  app.innerHTML = html;
  currentView = 'list';
}

// ── Detail view ───────────────────────────────────────────────────────────
async function loadDetail(id) {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading">Loading invoice...</div>';
  try {
    const inv = await api('/invoices/' + id);
    currentId = id;
    renderDetail(inv);
  } catch (e) {
    app.innerHTML = '<div class="error">' + e.message + '</div><a class="back-link" href="#" onclick="loadList();return false">← Back</a>';
  }
}

function renderDetail(inv) {
  const app = document.getElementById('app');
  let html = '<a class="back-link" href="#" onclick="loadList(listData.page || 1);return false">← Back to list</a>';

  // Metadata
  html += '<div class="card"><h2>' + inv.invoiceNumber + '</h2><div class="meta-grid">'
    + mi('PDF Status', statusBadge(inv.pdfStatus))
    + mi('Email Status', statusBadge(inv.emailStatus))
    + mi('Payment Status', paymentControl(inv))
    + mi('Organization', inv.organizationName || inv.organizationId || '—')
    + mi('Issue Date', formatDate(inv.issueDate))
    + mi('Due Date', formatDate(inv.dueDate))
    + mi('Currency', inv.currency || 'SEK')
    + mi('Invoice ID', '<code style="font-size:11px">' + inv.id + '</code>')
    + mi('Receipt ID', '<code style="font-size:11px">' + (inv.receiptId||'—') + '</code>')
    + mi('Sent At', inv.sentAt ? new Date(inv.sentAt).toLocaleString('sv-SE') : '—')
    + '</div></div>';

  // Line items
  html += '<div class="card"><h2>Line Items</h2><table><thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead><tbody>';
  for (const li of (inv.lineItems||[])) {
    html += '<tr><td>' + li.description + '</td><td style="text-align:right">' + li.quantity + '</td><td style="text-align:right">' + formatAmount(li.unitPrice) + '</td><td style="text-align:right">' + formatAmount(li.total) + '</td></tr>';
  }
  html += '</tbody></table></div>';

  // Totals + Legal
  const legal = inv.legalMetadata;
  html += '<div class="card"><h2>Totals & Legal</h2><div class="meta-grid">'
    + mi('Netto (Subtotal)', formatAmount(inv.subtotal) + ' ' + (inv.currency||'SEK'))
    + mi('Moms (' + (inv.taxRate||0) + '%)', formatAmount(inv.taxAmount) + ' ' + (inv.currency||'SEK'))
    + mi('Totalt', '<strong>' + formatAmount(inv.totalAmount) + ' ' + (inv.currency||'SEK') + '</strong>')
    + (legal ? mi('Kontrollenhet', legal.kontrollenhet || '—') : '')
    + (legal ? mi('Org Number', legal.orgNumber || '—') : '')
    + (legal ? mi('Company', legal.companyName || '—') : '')
    + (legal ? mi('Address', legal.address || '—') : '')
    + '</div></div>';

  // PDF
  html += '<div class="card"><h2>PDF</h2>';
  html += '<button class="btn btn-sm btn-muted" style="margin-bottom:8px" onclick="regeneratePdf(&apos;' + inv.id + '&apos;)">Regenerate PDF</button><div id="pdf-regenerate-status" style="margin-bottom:8px;font-size:13px"></div>';
  if (inv.pdfUrl) {
    html += '<p style="margin-bottom:8px"><a href="' + inv.pdfUrl + '" target="_blank" style="color:#0066cc">' + inv.pdfUrl + '</a></p>';
    html += '<iframe src="' + inv.pdfUrl + '" style="width:100%;height:500px;border:1px solid #e0e0e0;border-radius:4px" title="PDF preview"></iframe>';
  } else {
    html += '<p style="color:#888">No PDF available</p>';
  }
  html += '</div>';

  // Email events
  html += '<div class="card"><h2>Email Events</h2>';
  if (inv.emailEvents && inv.emailEvents.length) {
    for (const ev of inv.emailEvents) {
      html += '<div class="event-row"><span class="event-name">' + ev.event + '</span> <span class="event-time">' + new Date(ev.createdAt).toLocaleString('sv-SE') + '</span>';
      if (ev.metadata) html += '<pre style="margin:4px 0 0;font-size:11px;color:#666">' + JSON.stringify(ev.metadata, null, 2) + '</pre>';
      html += '</div>';
    }
  } else {
    html += '<p style="color:#888">No email events</p>';
  }
  html += '</div>';

  // Resend email
  html += '<div class="card"><h2>Resend Email</h2>'
    + '<div style="display:flex;gap:8px;align-items:center">'
    + '<input type="email" id="resend-to" placeholder="recipient@example.com" />'
    + '<button class="btn btn-primary" id="resend-btn" onclick="resendEmail(&apos;' + inv.id + '&apos;)">Resend</button>'
    + '</div><div id="resend-status" style="margin-top:8px;font-size:13px"></div></div>';

  // Raw JSON
  html += '<div class="card"><h2 class="collapsible" onclick="toggleJson(this)">Raw Invoice JSON</h2>'
    + '<div class="json-block" style="display:none" id="raw-json">' + JSON.stringify(inv, null, 2) + '</div></div>';

  app.innerHTML = html;
  currentView = 'detail';
}

function mi(label, value) {
  return '<div class="meta-item"><label>' + label + '</label><span>' + value + '</span></div>';
}

function toggleJson(el) {
  el.classList.toggle('open');
  const block = document.getElementById('raw-json');
  block.style.display = block.style.display === 'none' ? 'block' : 'none';
}

async function resendEmail(id) {
  const to = document.getElementById('resend-to').value.trim();
  const btn = document.getElementById('resend-btn');
  const status = document.getElementById('resend-status');
  if (!to) { status.innerHTML = '<span style="color:#dc3545">Enter an email address</span>'; return; }
  btn.disabled = true;
  status.textContent = 'Sending...';
  try {
    const res = await api('/invoices/' + id + '/resend-email', {
      method: 'POST',
      body: JSON.stringify({ to }),
    });
    status.innerHTML = '<span style="color:#155724">✓ Sent! ID: ' + (res.emailId||'ok') + '</span>';
  } catch (e) {
    status.innerHTML = '<span style="color:#dc3545">✗ ' + e.message + '</span>';
  }
  btn.disabled = false;
}

async function updatePaymentStatus(id, paymentStatus) {
  try {
    await api('/invoices/' + id + '/payment-status', {
      method: 'PATCH',
      body: JSON.stringify({ paymentStatus }),
    });
    if (currentView === 'detail') loadDetail(id);
    else loadList(listData.page || 1);
  } catch (e) {
    alert(e.message || 'Failed to update payment status');
  }
}

async function regeneratePdf(id) {
  const status = document.getElementById('pdf-regenerate-status');
  if (status) status.textContent = 'Regenerating PDF...';
  try {
    await api('/invoices/' + id + '/regenerate-pdf', { method: 'POST' });
    if (status) status.innerHTML = '<span style="color:#155724">✓ PDF regenerated</span>';
    loadDetail(id);
  } catch (e) {
    if (status) status.innerHTML = '<span style="color:#dc3545">✗ ' + e.message + '</span>';
  }
}

// Handle browser back/forward  
window.addEventListener('hashchange', () => {
  const hash = location.hash;
  if (hash.startsWith('#invoice/')) {
    loadDetail(hash.replace('#invoice/', ''));
  } else {
    loadList();
  }
});

// Initial load
if (TOKEN) loadList();
else document.getElementById('app').innerHTML = '<div class="empty">Enter your admin token above to get started.</div>';
</script>
</body>
</html>`;
