// CSV and PDF export for the Reports module. No third-party packages: the PDF writer below produces a
// plain text-and-table document (Helvetica, A4) from the same data the report API returns.

const TITLES = {
  overview: 'Overview', sales: 'Sales report', orders: 'Orders report', products: 'Products and categories report',
  customers: 'Customers report', preorders: 'Pre-orders report', bulk: 'Bulk orders report', inventory: 'Inventory report',
};
const STATUS_LABELS = { placed: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' };

const col = (key, label, type = 'text') => ({ key, label, type });

// Turns a report payload into plain tables: { heading, columns:[{key,label,type}], rows:[{...}] }.
export function reportTables(report) {
  const periodRows = (rows, columns) => ({ heading: 'Trend', columns: [col('period', 'Period'), ...columns], rows });
  switch (report.section) {
    case 'overview': {
      const c = report.cards;
      return [{
        heading: 'Key figures', columns: [col('metric', 'Metric'), col('value', 'Value', 'text'), col('previous', 'Previous period', 'text'), col('change', 'Change %', 'percent')],
        rows: [
          { metric: 'Revenue (delivered orders, Rs.)', value: c.revenue.value.toFixed(2), previous: c.revenue.previous.toFixed(2), change: c.revenue.change },
          { metric: 'Total orders', value: c.totalOrders.value, previous: c.totalOrders.previous, change: c.totalOrders.change },
          { metric: 'Delivered orders', value: c.deliveredOrders.value, previous: c.deliveredOrders.previous, change: c.deliveredOrders.change },
          { metric: 'Average order value (Rs.)', value: c.averageOrderValue.value.toFixed(2), previous: c.averageOrderValue.previous.toFixed(2), change: c.averageOrderValue.change },
          { metric: 'Total customers', value: c.totalCustomers.value, previous: '', change: null },
          { metric: 'New customers in period', value: c.totalCustomers.newInPeriod, previous: '', change: null },
        ],
      }];
    }
    case 'sales': {
      const s = report.summary;
      return [
        {
          heading: 'Summary', columns: [col('metric', 'Metric'), col('value', 'Value', 'money'), col('previous', 'Previous period', 'money'), col('change', 'Change %', 'percent')],
          rows: [
            { metric: 'Order value (not cancelled)', value: s.orderValue, previous: report.previous.orderValue, change: report.changes.orderValue },
            { metric: 'Delivered order value (revenue)', value: s.deliveredValue, previous: report.previous.deliveredValue, change: report.changes.deliveredValue },
            { metric: 'Average order value', value: s.averageOrderValue, previous: report.previous.averageOrderValue, change: report.changes.averageOrderValue },
            { metric: 'Cancelled order value', value: s.cancelledValue, previous: report.previous.cancelledValue, change: null },
            { metric: 'Collected revenue (paymentStatus paid)', value: s.collectedValue, previous: report.previous.collectedValue, change: null },
          ],
        },
        { heading: 'By order type', columns: [col('type', 'Type'), col('orders', 'Orders', 'int'), col('orderValue', 'Order value', 'money'), col('deliveredValue', 'Delivered value', 'money')], rows: report.byType },
        periodRows(report.series, [col('orders', 'Orders', 'int'), col('orderValue', 'Order value', 'money'), col('deliveredValue', 'Delivered value', 'money')]),
        { heading: 'Note', columns: [col('note', 'Note')], rows: [{ note: report.collection.note }] },
      ];
    }
    case 'orders':
      return [
        { heading: 'Status distribution', columns: [col('status', 'Status'), col('count', 'Orders', 'int'), col('percent', 'Share %', 'percent')], rows: report.distribution.map((r) => ({ ...r, status: STATUS_LABELS[r.status] || r.status })) },
        {
          heading: 'By order type', columns: [col('type', 'Type'), col('total', 'Total', 'int'), col('pending', 'Pending', 'int'), col('processing', 'Processing', 'int'), col('outForDelivery', 'Out for delivery', 'int'), col('delivered', 'Delivered', 'int'), col('cancelled', 'Cancelled', 'int')],
          rows: [{ type: 'Normal', ...report.byType.normal }, { type: 'Pre-order', ...report.byType.preorder }],
        },
        periodRows(report.series, [col('placed', 'Placed', 'int'), col('delivered', 'Delivered', 'int'), col('cancelled', 'Cancelled', 'int')]),
        { heading: 'Bulk requests (separate workflow)', columns: [col('bulkRequests', 'Requests received', 'int')], rows: [{ bulkRequests: report.bulkRequests }] },
      ];
    case 'products':
      return [
        { heading: `Top products (by ${report.sortedBy})`, columns: [col('name', 'Product'), col('unit', 'Unit'), col('quantity', 'Quantity sold', 'number'), col('sales', 'Sales value', 'money'), col('orders', 'Orders', 'int')], rows: report.topProducts },
        { heading: 'Categories', columns: [col('category', 'Category'), col('products', 'Products', 'int'), col('quantity', 'Quantity', 'number'), col('sales', 'Sales value', 'money')], rows: report.categories },
        { heading: `Low stock (${report.threshold} or fewer)`, columns: [col('name', 'Product'), col('category', 'Category'), col('stock', 'Stock', 'number'), col('unit', 'Unit')], rows: report.lowStock.products },
        { heading: 'Out of stock', columns: [col('name', 'Product'), col('category', 'Category'), col('unit', 'Unit')], rows: report.outOfStock.products },
      ];
    case 'customers':
      return [
        {
          heading: 'Summary', columns: [col('metric', 'Metric'), col('value', 'Value', 'text')],
          rows: [
            { metric: 'Total customers', value: report.totalCustomers }, { metric: 'New customers in period', value: report.newCustomers },
            { metric: 'Customers who ordered', value: report.activeCustomers }, { metric: 'Repeat customers (2+ orders)', value: report.repeatCustomers },
            { metric: 'Orders placed', value: report.ordersPlaced }, { metric: 'Order value (Rs.)', value: report.orderValue.toFixed(2) },
          ],
        },
        { heading: 'Orders per customer', columns: [col('label', 'Orders'), col('customers', 'Customers', 'int')], rows: report.buckets },
        { heading: 'Top customers by order value', columns: [col('name', 'Customer'), col('orders', 'Orders', 'int'), col('value', 'Order value', 'money')], rows: report.topCustomers },
        periodRows(report.registrations, [col('registrations', 'New customers', 'int')]),
      ];
    case 'preorders':
      return [
        {
          heading: `Summary (as of ${report.asOf})`, columns: [col('metric', 'Metric'), col('value', 'Value', 'text')],
          rows: [
            { metric: 'Pre-orders placed', value: report.total }, { metric: 'Upcoming (active, delivery today or later)', value: report.upcoming },
            { metric: 'Overdue (active, delivery date passed)', value: report.overdue }, { metric: 'Completed (delivered)', value: report.completed },
            { metric: 'Cancelled', value: report.cancelled }, { metric: 'Value, not cancelled (Rs.)', value: report.value.toFixed(2) },
          ],
        },
        { heading: 'Delivery date distribution', columns: [col('date', 'Delivery date'), col('orders', 'Orders', 'int'), col('value', 'Value', 'money')], rows: report.deliveryDates },
      ];
    case 'bulk':
      return [
        { heading: 'Requests by status', columns: [col('status', 'Status'), col('count', 'Requests', 'int'), col('quotationValue', 'Quotation value', 'money')], rows: report.statuses },
        {
          heading: 'Quotations (not revenue)', columns: [col('metric', 'Metric'), col('value', 'Value', 'text')],
          rows: [{ metric: 'Requests received', value: report.total }, { metric: 'Requests with a quotation', value: report.quotedRequests }, { metric: 'Awaiting customer decision (Rs.)', value: report.openQuotationValue.toFixed(2) }, { metric: 'Approved, processing or completed (Rs.)', value: report.approvedQuotationValue.toFixed(2) }],
        },
        periodRows(report.series, [col('requests', 'Requests', 'int'), col('quotationValue', 'Quotation value', 'money')]),
      ];
    case 'inventory':
      return [
        {
          heading: 'Summary', columns: [col('metric', 'Metric'), col('value', 'Value', 'text')],
          rows: [{ metric: 'Total products', value: report.totals.totalProducts }, { metric: 'Total available stock (mixed units)', value: report.totals.totalStock }, { metric: `Low stock (${report.threshold} or fewer)`, value: report.totals.lowStock }, { metric: 'Out of stock', value: report.totals.outOfStock }],
        },
        { heading: 'Low stock', columns: [col('name', 'Product'), col('category', 'Category'), col('stock', 'Stock', 'number'), col('unit', 'Unit')], rows: report.lowStock.products },
        { heading: 'Out of stock', columns: [col('name', 'Product'), col('category', 'Category'), col('unit', 'Unit')], rows: report.outOfStock.products },
        { heading: 'Goods received from suppliers in period', columns: [col('unit', 'Unit'), col('purchases', 'Purchases', 'int'), col('quantity', 'Quantity', 'number')], rows: report.movement.receivedFromSuppliers },
        { heading: 'Note', columns: [col('note', 'Note')], rows: [{ note: report.movement.note }] },
      ];
    default:
      return [];
  }
}

function formatCell(value, type) {
  if (value === null || value === undefined) return '';
  if (type === 'money') return Number(value).toFixed(2);
  if (type === 'percent') return Number(value).toFixed(1);
  return String(value);
}

// A cell that starts with = + - @ would be run as a formula by spreadsheet apps; text columns get a
// leading apostrophe so names typed by customers or staff can never execute.
function csvCell(value, type) {
  let text = formatCell(value, type);
  if (type === 'text' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function headerLines(report) {
  const range = report.range;
  return [
    `Janai - ${TITLES[report.section] || report.section}`,
    `Period: ${range.from} to ${range.to} (${range.label})`,
    `Timezone: ${range.timezone}`,
    `Generated: ${report.generatedAt}`,
  ];
}

export function toCsv(report) {
  const lines = headerLines(report).map((line) => csvCell(line, 'plain'));
  for (const table of reportTables(report)) {
    lines.push('', csvCell(table.heading, 'plain'), table.columns.map((c) => csvCell(c.label, 'plain')).join(','));
    for (const row of table.rows) lines.push(table.columns.map((c) => csvCell(row[c.key], c.type)).join(','));
  }
  // BOM so Excel opens UTF-8 names correctly.
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ------------------------------------------------------------ PDF
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 40;
const ROW_HEIGHT = 12;

// Helvetica (WinAnsi) cannot show every character; anything outside printable ASCII becomes "?".
const pdfText = (value) => String(value ?? '').replace(/[^\x20-\x7E]/g, '?').replace(/([\\()])/g, '\\$1');

export function toPdf(report) {
  const pages = [];
  let ops = [];
  let y = PAGE_HEIGHT - MARGIN;
  const text = (x, atY, size, bold, value) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${atY.toFixed(1)} Td (${pdfText(value)}) Tj ET`);
  const newPage = () => { pages.push(ops); ops = []; y = PAGE_HEIGHT - MARGIN; };

  const [title, ...meta] = headerLines(report);
  text(MARGIN, y, 16, true, title);
  y -= 20;
  for (const line of meta) { text(MARGIN, y, 9, false, line); y -= 13; }

  for (const table of reportTables(report)) {
    const width = (PAGE_WIDTH - 2 * MARGIN) / table.columns.length;
    const maxChars = Math.max(4, Math.floor(width / 4.4) - 1);
    const cell = (value, type) => {
      const formatted = type === 'money' ? `Rs. ${formatCell(value, type)}` : formatCell(value, type);
      return formatted.length > maxChars ? `${formatted.slice(0, maxChars - 1)}~` : formatted;
    };
    const drawHeader = () => {
      table.columns.forEach((c, index) => text(MARGIN + index * width, y, 8, true, cell(c.label, 'plain')));
      y -= ROW_HEIGHT;
    };
    if (y - 60 < MARGIN) newPage();
    y -= 10;
    text(MARGIN, y, 11, true, table.heading);
    y -= 15;
    drawHeader();
    if (!table.rows.length) { text(MARGIN, y, 8, false, 'No data for this period.'); y -= ROW_HEIGHT; }
    for (const row of table.rows) {
      if (y - ROW_HEIGHT < MARGIN + 20) { newPage(); drawHeader(); }
      table.columns.forEach((c, index) => text(MARGIN + index * width, y, 8, false, cell(row[c.key], c.type)));
      y -= ROW_HEIGHT;
    }
  }
  pages.push(ops);
  pages.forEach((pageOps, index) => pageOps.push(`BT /F1 8 Tf ${MARGIN} 24 Td (Page ${index + 1} of ${pages.length}) Tj ET`));

  // Objects: 1 catalog, 2 page tree, 3 regular font, 4 bold font, then a page + content stream per page.
  const objects = [];
  const kids = pages.map((_, index) => `${5 + index * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((pageOps, index) => {
    const stream = pageOps.join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  let output = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xrefStart = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => { output += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  // Everything is printable ASCII, so string length equals byte length and the offsets above are exact.
  return Buffer.from(output, 'latin1');
}

export function buildExport(report, format) {
  const stamp = `${report.range.from}_to_${report.range.to}`;
  const filename = `janai-${report.section}-${stamp}.${format}`;
  if (format === 'pdf') return { filename, contentType: 'application/pdf', body: toPdf(report) };
  return { filename, contentType: 'text/csv; charset=utf-8', body: Buffer.from(toCsv(report), 'utf8') };
}
