/**
 * Pure-Node PDF generation for Gojo invoices using jsPDF.
 * No browser/Chromium dependency — runs on any Node.js host including Render free tier.
 */
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { Invoice } from '../types/domain.js';

function fmt(n: number): string {
  return n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function generateInvoicePdf(invoice: Invoice): Buffer {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = margin;

  // ─── HEADER ─────────────────────────────────────────────
  doc.setFontSize(28);
  doc.setTextColor(124, 58, 237); // #7C3AED
  doc.text('Gojo', margin, y + 8);

  const legal = invoice.legalMetadata;
  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128); // #6B7280
  if (legal?.companyName) {
    y += 12;
    doc.text(legal.companyName, margin, y);
  }
  if (legal?.address) {
    y += 5;
    doc.setFontSize(9);
    doc.setTextColor(156, 163, 175);
    doc.text(legal.address, margin, y);
  }

  // Invoice number (right-aligned)
  doc.setFontSize(9);
  doc.setTextColor(156, 163, 175);
  doc.text('FAKTURA', pageWidth - margin, margin, { align: 'right' });
  doc.setFontSize(20);
  doc.setTextColor(17, 24, 39);
  doc.text(invoice.invoiceNumber, pageWidth - margin, margin + 8, { align: 'right' });

  y += 15;

  // ─── META ───────────────────────────────────────────────
  const issueDate = typeof invoice.issueDate === 'string'
    ? invoice.issueDate
    : new Date().toISOString().split('T')[0];

  doc.setFontSize(8);
  doc.setTextColor(156, 163, 175);
  doc.text('FAKTURADATUM', margin, y);
  doc.text('FÖRFALLODATUM', margin + 55, y);
  doc.text('VALUTA', margin + 110, y);

  y += 5;
  doc.setFontSize(11);
  doc.setTextColor(55, 65, 81);
  doc.text(issueDate, margin, y);
  doc.text(String(invoice.dueDate), margin + 55, y);
  doc.text(invoice.currency, margin + 110, y);

  y += 12;

  // ─── LINE ITEMS TABLE ──────────────────────────────────
  const tableBody = invoice.lineItems.map((li) => [
    li.description,
    String(li.quantity),
    fmt(li.unitPrice),
    fmt(li.total),
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Beskrivning', 'Antal', 'À-pris', 'Belopp']],
    body: tableBody,
    headStyles: {
      fillColor: [249, 250, 251],
      textColor: [156, 163, 175],
      fontStyle: 'bold',
      fontSize: 8,
      cellPadding: 4,
    },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'center', cellWidth: 25 },
      2: { halign: 'right', cellWidth: 35 },
      3: { halign: 'right', cellWidth: 35 },
    },
    bodyStyles: {
      fontSize: 10,
      textColor: [17, 24, 39],
      cellPadding: 4,
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251],
    },
    theme: 'plain',
    didDrawCell: (data: any) => {
      // Bottom border for each row
      if (data.section === 'body') {
        doc.setDrawColor(229, 231, 235);
        doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // ─── TOTALS ─────────────────────────────────────────────
  const totalsX = pageWidth - margin - 80;

  doc.setFontSize(11);
  doc.setTextColor(55, 65, 81);
  doc.text('Netto', totalsX, y);
  doc.text(`${invoice.currency} ${fmt(invoice.subtotal)}`, pageWidth - margin, y, { align: 'right' });

  y += 7;
  doc.text(`Moms (${invoice.taxRate}%)`, totalsX, y);
  doc.text(`${invoice.currency} ${fmt(invoice.taxAmount)}`, pageWidth - margin, y, { align: 'right' });

  y += 3;
  doc.setDrawColor(17, 24, 39);
  doc.setLineWidth(0.5);
  doc.line(totalsX, y, pageWidth - margin, y);

  y += 8;
  doc.setFontSize(16);
  doc.setFont(undefined as any, 'bold');
  doc.setTextColor(17, 24, 39);
  doc.text('Totalt', totalsX, y);
  doc.setTextColor(124, 58, 237);
  doc.text(`${invoice.currency} ${fmt(invoice.totalAmount)}`, pageWidth - margin, y, { align: 'right' });

  // ─── NOTES ──────────────────────────────────────────────
  if (invoice.notes) {
    y += 14;
    doc.setFontSize(9);
    doc.setTextColor(55, 65, 81);
    doc.setFont(undefined as any, 'bold');
    doc.text('Anteckningar:', margin, y);
    doc.setFont(undefined as any, 'normal');
    y += 5;
    doc.text(invoice.notes, margin, y, { maxWidth: pageWidth - 2 * margin });
  }

  // ─── LEGAL INFO ─────────────────────────────────────────
  y += 16;
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  doc.setFontSize(8);
  doc.setFont(undefined as any, 'bold');
  doc.setTextColor(55, 65, 81);
  doc.text('JURIDISK INFORMATION', margin, y);
  doc.setFont(undefined as any, 'normal');
  doc.setTextColor(107, 114, 128);

  y += 5;
  if (legal?.companyName) { doc.text(`Företag: ${legal.companyName}`, margin, y); y += 4; }
  if (legal?.orgNumber) { doc.text(`Organisationsnummer: ${legal.orgNumber}`, margin, y); y += 4; }
  if (legal?.kontrollenhet) { doc.text(`Kontrollenhet: ${legal.kontrollenhet}`, margin, y); y += 4; }
  if (legal?.address) { doc.text(`Adress: ${legal.address}`, margin, y); y += 4; }

  // ─── FOOTER ─────────────────────────────────────────────
  y += 10;
  doc.setFontSize(8);
  doc.setTextColor(156, 163, 175);
  doc.text(`Genererad av Gojo · ${issueDate}`, pageWidth / 2, y, { align: 'center' });

  // Return as Buffer
  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}
