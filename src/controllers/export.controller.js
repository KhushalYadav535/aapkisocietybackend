const { v4: uuidv4 } = require('uuid');
const { withTenant, pool, isPostgresEnabled } = require('../config/postgres');
const { isPlatformRole } = require('../constants/roles');

// ─── Tally XML Export ──────────────────────────────────────────────────
exports.tallyExport = async (req, res) => {
  try {
    if (!['ADMIN', 'TREASURER', 'COMMITTEE'].includes(req.user.role) && !isPlatformRole(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { from_date, to_date, voucher_types } = req.body;
    const from = from_date || new Date(new Date().getFullYear(), 3, 1).toISOString().split('T')[0]; // FY start
    const to = to_date || new Date().toISOString().split('T')[0];
    const types = voucher_types || ['RECEIPT', 'PAYMENT', 'JOURNAL', 'CONTRA', 'SALES', 'PURCHASE'];

    await withTenant(req.user.society_id, async (client) => {
      // Get ledgers
      const ledgersResult = await client.query(`
        SELECT DISTINCT account_name, account_type, gst_number, pan_number, contact_name
        FROM account_entries ae
        WHERE ae.transaction_date BETWEEN $1 AND $2
        UNION
        SELECT DISTINCT u.first_name || ' ' || u.last_name as account_name,
               CASE WHEN u.role = 'RESIDENT' THEN 'Sundry Debtors' ELSE 'Sundry Creditors' END as account_type,
               NULL as gst_number, NULL as pan_number, u.first_name || ' ' || u.last_name as contact_name
        FROM payments p
        JOIN platform.users u ON u.id = p.member_id
        WHERE p.payment_date::DATE BETWEEN $1 AND $2
      `, [from, to]);

      // Get vouchers
      const voucherQueries = [];
      const params = [from, to, req.user.society_id];

      if (types.includes('RECEIPT')) {
        voucherQueries.push(client.query(`
          SELECT 'RECEIPT' as voucher_type, p.id, p.payment_date as date,
                 u.first_name || ' ' || u.last_name as party_name, p.amount,
                 p.payment_method as reference, 'Maintenance Receipt' as narration
          FROM payments p
          JOIN platform.users u ON u.id = p.member_id
          WHERE p.society_id = $3 AND p.payment_date::DATE BETWEEN $1 AND $2 AND p.status = 'SUCCESS'
        `, [from, to, req.user.society_id]));
      }

      if (types.includes('PAYMENT')) {
        voucherQueries.push(client.query(`
          SELECT 'PAYMENT' as voucher_type, v.id, v.payment_date as date,
                 v.vendor_name as party_name, v.amount, v.reference_number as reference,
                 COALESCE(v.description, v.category) as narration
          FROM vendor_payments v
          WHERE v.society_id = $3 AND v.payment_date::DATE BETWEEN $1 AND $2 AND v.status = 'SUCCESS'
        `, [from, to, req.user.society_id]));
      }

      if (types.includes('SALES')) {
        voucherQueries.push(client.query(`
          SELECT 'SALES' as voucher_type, b.id, b.bill_date as date,
                 u.first_name || ' ' || u.last_name as party_name, b.total_amount as amount,
                 b.bill_number as reference, b.description as narration
          FROM bills b
          JOIN platform.users u ON u.id = b.member_id
          WHERE b.society_id = $3 AND b.bill_date BETWEEN $1 AND $2
        `, [from, to, req.user.society_id]));
      }

      const results = await Promise.all(voucherQueries);
      const allVouchers = results.flatMap(r => r.rows);

      const tallyXml = generateTallyXML(ledgersResult.rows, allVouchers, from, to);

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="tally_export_${from}_${to}.xml"`);
      res.send(tallyXml);
    });
  } catch (error) {
    console.error('Tally export error:', error);
    res.status(500).json({ error: 'Failed to export Tally data' });
  }
};

function generateTallyXML(ledgers, vouchers, fromDate, toDate) {
  const guid = (n) => `{${uuidv4().toUpperCase().substring(0, 8)}-${n.toString().padStart(4, '0')}}`;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>AapkiSociety</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
`;

  // Ledger Masters
  for (const ledger of ledgers) {
    const ledgerGuid = guid(Math.floor(Math.random() * 9000) + 1000);
    const groupName = ledger.account_type || 'Sundry Debtors';
    xml += `        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <LEDGER NAME="${escapeXml(ledger.account_name)}" ISACTIVE="Yes">
            <GUID>${ledgerGuid}</GUID>
            <PARENT>${escapeXml(groupName)}</PARENT>
            <MAILINGNAME>${escapeXml(ledger.contact_name || ledger.account_name)}</MAILINGNAME>
            <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
            ${ledger.gst_number ? `<STATENAME>Maharashtra</STATENAME>` : ''}
            ${ledger.gst_number ? `<GSTIN>${escapeXml(ledger.gst_number)}</GSTIN>` : ''}
          </LEDGER>
        </TALLYMESSAGE>
`;
  }

  // Vouchers
  const voucherTypeMap = { RECEIPT: 'Receipt', PAYMENT: 'Payment', JOURNAL: 'Journal', CONTRA: 'Contra', SALES: 'Sales', PURCHASE: 'Purchase' };
  let voucherNum = 1;

  for (const voucher of vouchers) {
    const voucherGuid = guid(voucherNum++);
    const voucherType = voucherTypeMap[voucher.voucher_type] || 'Journal';
    const date = new Date(voucher.date).toLocaleDateString('en-GB').split('/').reverse().join('');

    xml += `        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER REMOTEID="${voucherGuid}" VCHTYPE="${voucherType}" ACTION="Create">
            <DATE>${date}</DATE>
            <VOUCHERNUMBER>${voucherNum.toString().padStart(6, '0')}</VOUCHERNUMBER>
            <REFERENCE>${escapeXml(voucher.reference || '')}</REFERENCE>
            <NARRATION>${escapeXml(voucher.narration || '')}</NARRATION>
            <PARTYLEDGERNAME>${escapeXml(voucher.party_name)}</PARTYLEDGERNAME>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXml(voucher.party_name)}</LEDGERNAME>
              <AMOUNT>${voucher.amount > 0 ? voucher.amount : -voucher.amount}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Bank Account</LEDGERNAME>
              <AMOUNT>${voucher.amount > 0 ? -voucher.amount : voucher.amount}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
`;
  }

  xml += `      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

  return xml;
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Excel Export (using json2csv / xlsx) ──────────────────────────────
exports.excelExport = async (req, res) => {
  try {
    const { report_type, from_date, to_date, data } = req.body;

    // If data is provided directly, export it
    if (data && Array.isArray(data)) {
      const XLSX = require('xlsx');
      const ws = XLSX.utils.json_to_sheet(data);

      // Format currency columns
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let row = range.s.r + 1; row <= range.e.r; row++) {
        for (let col = range.s.c; col <= range.e.c; col++) {
          const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
          if (cell && typeof cell.v === 'number') {
            cell.z = '"\\u20B9"#,##0.00';
          }
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, report_type || 'Report');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${report_type || 'report'}_${Date.now()}.xlsx"`);
      return res.send(buf);
    }

    res.status(400).json({ error: 'No data provided for export' });
  } catch (error) {
    console.error('Excel export error:', error);
    res.status(500).json({ error: 'Failed to export Excel' });
  }
};

// ─── Multi-Sheet Excel Export ──────────────────────────────────────────
exports.multiSheetExcelExport = async (req, res) => {
  try {
    const { report_type, from_date, to_date, data, metadata } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: 'No data provided for export' });
    }

    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();

    // Data sheet
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, report_type || 'Report');

    // Metadata sheet
    const metadataWs = XLSX.utils.json_to_sheet([metadata]);
    XLSX.utils.book_append_sheet(wb, metadataWs, 'Metadata');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${report_type || 'report'}_${Date.now()}.xlsx"`);
    return res.send(buf);
  } catch (error) {
    console.error('Multi-sheet Excel export error:', error);
    res.status(500).json({ error: 'Failed to export multi-sheet Excel' });
  }
};

// ─── PDF Export ────────────────────────────────────────────────────────
exports.pdfExport = async (req, res) => {
  try {
    const { report_type, title, from_date, to_date, society_name, generated_by, data } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: 'No data provided for export' });
    }

    // Generate PDF using pdfkit (if available) or return data with formatting instructions
    let buf;
    try {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ size: 'A4', margin: 50 });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {
        buf = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${report_type || 'report'}_${Date.now()}.pdf"`);
        res.send(buf);
      });

      // Header
      doc.fontSize(16).text(society_name || 'AapkiSociety', { align: 'center' });
      doc.fontSize(12).text(title || report_type, { align: 'center' });
      doc.fontSize(10).text(`Period: ${from_date} to ${to_date}`, { align: 'center' });
      doc.fontSize(8).text(`Generated: ${new Date().toLocaleString('en-IN')} | ${generated_by || 'System'}`, { align: 'center' });
      doc.moveDown(2);

      // Table
      if (data.length > 0) {
        const keys = Object.keys(data[0]);
        const tableTop = doc.y;
        const colWidths = keys.map((_, i) => Math.floor((doc.page.width - 100) / keys.length));

        // Header row
        doc.fontSize(9).fillColor('#333');
        keys.forEach((key, i) => {
          doc.text(key.replace(/_/g, ' ').toUpperCase(), 50 + (i === 0 ? 0 : colWidths.slice(0, i).reduce((a, b) => a + b, 0)), tableTop, { width: colWidths[i] });
        });

        doc.moveTo(50, tableTop + 15, doc.page.width - 50, tableTop + 15).stroke();
        doc.moveDown();

        // Data rows
        data.slice(0, 100).forEach((row, rowIdx) => {
          if (doc.y > doc.page.height - 60) doc.addPage();
          keys.forEach((key, i) => {
            const val = row[key] !== null && row[key] !== undefined ? String(row[key]) : '-';
            doc.text(val.substring(0, 30), 50 + (i === 0 ? 0 : colWidths.slice(0, i).reduce((a, b) => a + b, 0)), doc.y, { width: colWidths[i] });
          });
          doc.moveDown(0.5);
        });

        if (data.length > 100) {
          doc.moveDown();
          doc.fontSize(8).text(`... and ${data.length - 100} more rows`, { align: 'center' });
        }
      }

      // Watermark
      const pages = doc.bufferedPageRange();
      for (let i = pages.start; i < pages.start + pages.count; i++) {
        doc.switchToPage(i);
        doc.save();
        doc.rotate(45, { origin: [doc.page.width / 2, doc.page.height / 2] });
        doc.fontSize(60).fillColor('#e5e7eb').opacity(0.15);
        doc.text('AapkiSociety', doc.page.width / 2 - 180, doc.page.height / 2 - 30);
        doc.restore();
      }

      // Footer
      doc.fontSize(8).fillColor('#999').text('CONFIDENTIAL — Generated by AapkiSociety', 50, doc.page.height - 50, { align: 'center' });

      doc.end();
    } catch (pdfError) {
      // If pdfkit not available, return data with metadata for client-side PDF
      res.json({
        message: 'PDF generation requires pdfkit package. Returning data for client-side rendering.',
        metadata: { report_type, title, from_date, to_date, society_name, generated_by, total_rows: data.length },
        data
      });
    }
  } catch (error) {
    console.error('PDF export error:', error);
    res.status(500).json({ error: 'Failed to export PDF' });
  }
};

// ─── Tally TDS Export ────────────────────────────────────────────────
exports.tallyTdsExport = async (req, res) => {
  try {
    const { pool, withTenant, isPostgresEnabled } = require('../config/postgres');
    const role = req.user.role;
    if (!['ADMIN', 'TREASURER', 'COMMITTEE', 'PLATFORM_ADMIN'].includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { period, from_date, to_date } = req.body;
    let deductions = [];

    if (isPostgresEnabled && req.user.society_id) {
      await withTenant(req.user.society_id, async (client) => {
        const r = await client.query(`
          SELECT v.*, ve.debit_amount, ve.credit_amount, a.name as account_name, a.group_name
          FROM vouchers v
          JOIN voucher_entries ve ON v.id = ve.voucher_id
          JOIN accounts a ON ve.account_id = a.id
          WHERE v.voucher_type = 'PAYMENT'
            AND a.group_name ILIKE '%TDS%'
            AND v.voucher_date BETWEEN $1 AND $2
            AND v.status = 'APPROVED'
          ORDER BY v.voucher_date
        `, [from_date || '2020-01-01', to_date || '2099-12-31']);
        deductions = r.rows;
      });
    }

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>\n`;

    for (const d of deductions) {
      const amt = parseFloat(d.debit_amount || d.credit_amount || 0);
      xml += `<TALLYMESSAGE xmlns:UDF="TallyUDF">\n`;
      xml += `  <VOUCHER VCHTYPE="Payment" ACTION="Create">\n`;
      xml += `    <DATE>${(d.voucher_date || '').replace(/-/g, '')}</DATE>\n`;
      xml += `    <NARRATION>TDS Deduction - ${d.narration || d.account_name}</NARRATION>\n`;
      xml += `    <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>\n`;
      xml += `    <ALLLEDGERENTRIES.LIST>\n`;
      xml += `      <LEDGERNAME>TDS Payable - ${d.account_name}</LEDGERNAME>\n`;
      xml += `      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n`;
      xml += `      <AMOUNT>-${amt.toFixed(2)}</AMOUNT>\n`;
      xml += `    </ALLLEDGERENTRIES.LIST>\n`;
      xml += `    <ALLLEDGERENTRIES.LIST>\n`;
      xml += `      <LEDGERNAME>${d.account_name || 'Bank Account'}</LEDGERNAME>\n`;
      xml += `      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n`;
      xml += `      <AMOUNT>${amt.toFixed(2)}</AMOUNT>\n`;
      xml += `    </ALLLEDGERENTRIES.LIST>\n`;
      xml += `  </VOUCHER>\n`;
      xml += `</TALLYMESSAGE>\n`;
    }

    xml += `</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="tds_tally_${period || 'export'}.xml"`);
    res.send(xml);
  } catch (error) {
    console.error('Tally TDS export error:', error);
    res.status(500).json({ error: 'Failed to export TDS for Tally' });
  }
};

// ─── Tally Validation Report ─────────────────────────────────────────
exports.tallyValidation = async (req, res) => {
  try {
    const { xml_content } = req.body;
    const errors = [];
    const warnings = [];

    if (!xml_content || typeof xml_content !== 'string') {
      return res.status(400).json({ error: 'xml_content is required' });
    }

    if (!xml_content.includes('<ENVELOPE>')) errors.push('Missing ENVELOPE root element');
    if (!xml_content.includes('<HEADER>')) errors.push('Missing HEADER element');
    if (!xml_content.includes('<TALLYMESSAGE')) errors.push('No TALLYMESSAGE elements found');

    const voucherCount = (xml_content.match(/<VOUCHER /g) || []).length;
    const ledgerCount = (xml_content.match(/<ALLLEDGERENTRIES.LIST>/g) || []).length;

    if (voucherCount === 0) errors.push('No vouchers found in export');
    if (ledgerCount < voucherCount * 2) warnings.push('Some vouchers may have incomplete ledger entries (expected at least 2 per voucher)');

    const amountMatches = xml_content.match(/<AMOUNT>([^<]+)<\/AMOUNT>/g) || [];
    let totalDebit = 0, totalCredit = 0;
    amountMatches.forEach(m => {
      const val = parseFloat(m.replace(/<\/?AMOUNT>/g, ''));
      if (val < 0) totalDebit += Math.abs(val);
      else totalCredit += val;
    });

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      warnings.push(`Debit/Credit mismatch: Debit=${totalDebit.toFixed(2)} Credit=${totalCredit.toFixed(2)}`);
    }

    res.json({
      valid: errors.length === 0,
      voucher_count: voucherCount,
      ledger_entry_count: ledgerCount,
      total_debit: totalDebit.toFixed(2),
      total_credit: totalCredit.toFixed(2),
      errors,
      warnings,
    });
  } catch (error) {
    console.error('Tally validation error:', error);
    res.status(500).json({ error: 'Failed to validate Tally XML' });
  }
};

// ─── Export History ──────────────────────────────────────────────────
exports.recordExportHistory = async (req, res) => {
  try {
    const { pool, isPostgresEnabled, ensurePlatformSchema } = require('../config/postgres');
    if (!isPostgresEnabled) return res.status(400).json({ error: 'PostgreSQL required' });

    await ensurePlatformSchema();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS platform.export_history (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        society_id TEXT,
        export_type TEXT,
        report_type TEXT,
        format TEXT,
        row_count INTEGER DEFAULT 0,
        file_size INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const { v4: uuidv4 } = require('uuid');
    const { export_type, report_type, format, row_count, file_size } = req.body;
    const id = uuidv4();

    await pool.query(
      `INSERT INTO platform.export_history (id, user_id, society_id, export_type, report_type, format, row_count, file_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, req.user.id, req.user.society_id || 'platform', export_type, report_type, format, row_count || 0, file_size || 0]
    );

    res.json({ message: 'Export recorded', id });
  } catch (error) {
    console.error('Record export history error:', error);
    res.status(500).json({ error: 'Failed to record export' });
  }
};

exports.getExportHistory = async (req, res) => {
  try {
    const { pool, isPostgresEnabled } = require('../config/postgres');
    if (!isPostgresEnabled) return res.json({ history: [] });

    const societyId = req.user.society_id || 'platform';
    const result = await pool.query(
      `SELECT eh.*, u.first_name || ' ' || u.last_name AS exported_by
       FROM platform.export_history eh
       LEFT JOIN platform.users u ON u.id = eh.user_id
       WHERE eh.society_id = $1
       ORDER BY eh.created_at DESC
       LIMIT 100`,
      [societyId]
    );

    res.json({ history: result.rows });
  } catch (error) {
    console.error('Get export history error:', error);
    res.status(500).json({ error: 'Failed to get export history' });
  }
};