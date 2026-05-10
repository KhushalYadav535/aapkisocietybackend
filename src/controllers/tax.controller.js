const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled } = require('../config/postgres');

const ensureTaxTables = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS gst_returns (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      return_type TEXT,
      period TEXT,
      payload JSONB DEFAULT '{}'::jsonb,
      status TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS tds_returns (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      form_type TEXT,
      period TEXT,
      payload JSONB DEFAULT '{}'::jsonb,
      status TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
};

exports.createGSTR = (req, res) => {
  try {
    const { return_type, period, payload } = req.body;
    const now = new Date().toISOString();
    const record = {
      id: uuidv4(),
      society_id: req.user.society_id,
      return_type: return_type || 'GSTR-1',
      period,
      payload: payload || {},
      status: 'GENERATED',
      created_at: now
    };

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureTaxTables(client);
        await client.query(
          `INSERT INTO gst_returns (id, society_id, return_type, period, payload, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$7)`,
          [record.id, record.society_id, record.return_type, record.period, JSON.stringify(record.payload), record.status, record.created_at]
        );
        return res.status(201).json({ record });
      }).catch(() => res.status(500).json({ error: 'Failed to generate GSTR' }));
    }

    const db = getDb();
    db.get('gst_returns').push(record).write();
    res.status(201).json({ record });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate GSTR' });
  }
};

exports.createTDS = (req, res) => {
  try {
    const { form_type, period, payload } = req.body;
    const now = new Date().toISOString();
    const record = {
      id: uuidv4(),
      society_id: req.user.society_id,
      form_type: form_type || '26Q',
      period,
      payload: payload || {},
      status: 'GENERATED',
      created_at: now
    };

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureTaxTables(client);
        await client.query(
          `INSERT INTO tds_returns (id, society_id, form_type, period, payload, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$7)`,
          [record.id, record.society_id, record.form_type, record.period, JSON.stringify(record.payload), record.status, record.created_at]
        );
        return res.status(201).json({ record });
      }).catch(() => res.status(500).json({ error: 'Failed to generate TDS' }));
    }

    const db = getDb();
    db.get('tds_returns').push(record).write();
    res.status(201).json({ record });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate TDS' });
  }
};

exports.list = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureTaxTables(client);
        const [gstR, tdsR] = await Promise.all([
          client.query('SELECT * FROM gst_returns ORDER BY created_at DESC'),
          client.query('SELECT * FROM tds_returns ORDER BY created_at DESC')
        ]);
        return res.json({
          gst_returns: gstR.rows,
          tds_returns: tdsR.rows
        });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch tax returns' }));
    }

    const db = getDb();
    res.json({
      gst_returns: db.get('gst_returns').filter({ society_id: req.user.society_id }).value() || [],
      tds_returns: db.get('tds_returns').filter({ society_id: req.user.society_id }).value() || []
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tax returns' });
  }
};

exports.getGSTR1View = (req, res) => {
  if (!isPostgresEnabled || !req.user.society_id) {
    return res.status(400).json({ error: 'PostgreSQL not enabled or society not identified' });
  }
  const { period } = req.query || req.params || {};
  if (!period) {
    return res.status(400).json({ error: 'Period is required' });
  }

  return withTenant(req.user.society_id, async (client) => {
    // Query bills with GST > 0 joined with bill_items to get tax rates
    const r = await client.query(`
      SELECT
        bi.tax_rate,
        COALESCE(SUM(bi.amount), 0) AS taxable_value,
        COALESCE(SUM(bi.tax_amount), 0) AS total_tax_amount,
        CASE
          WHEN bi.tax_rate = 0 THEN COALESCE(SUM(bi.tax_amount), 0)
          ELSE 0
        END AS exempt_amount,
        COUNT(b.id) AS bill_count
      FROM bills b
      LEFT JOIN bill_items bi ON b.id = bi.bill_id
      WHERE b.society_id = $1
        AND b.billing_period = $2
        AND b.status NOT IN ('REJECTED')
        AND b.tax_amount > 0
      GROUP BY bi.tax_rate
      ORDER BY bi.tax_rate
    `, [req.user.society_id, period]);

    const rates = [0, 5, 12, 18, 28];
    const byRate = rates.map(rate => {
      const row = r.rows.find(row => Number(row.tax_rate) === rate) || {};
      const taxable = Number(row.taxable_value) || 0;
      const totalTax = Number(row.total_tax_amount) || 0;
      // For interstate: IGST = total tax; For intrastate: CGST = SGST = tax/2
      const igst = rate > 0 ? totalTax : 0;
      const cgst = rate > 0 ? totalTax / 2 : 0;
      const sgst = rate > 0 ? totalTax / 2 : 0;
      return {
        rate,
        taxable_value: taxable,
        igst: parseFloat(igst.toFixed(2)),
        cgst: parseFloat(cgst.toFixed(2)),
        sgst: parseFloat(sgst.toFixed(2)),
        cess: 0,
        count: Number(row.bill_count) || 0
      };
    });

    const summary = {
      total_taxable_value: byRate.reduce((s, r) => s + r.taxable_value, 0),
      total_igst: byRate.reduce((s, r) => s + r.igst, 0),
      total_cgst: byRate.reduce((s, r) => s + r.cgst, 0),
      total_sgst: byRate.reduce((s, r) => s + r.sgst, 0),
      total_cess: 0
    };

    return res.json({
      period,
      summary,
      by_rate: byRate,
      generated_at: new Date().toISOString()
    });
  }).catch((err) => { console.error('getGSTR1View error:', err); res.status(500).json({ error: 'Failed to get GSTR-1 view' }); });
};

exports.getGSTR3BView = (req, res) => {
  if (!isPostgresEnabled || !req.user.society_id) {
    return res.status(400).json({ error: 'PostgreSQL not enabled or society not identified' });
  }
  const { period } = req.query || req.params || {};
  if (!period) {
    return res.status(400).json({ error: 'Period is required' });
  }

  return withTenant(req.user.society_id, async (client) => {
    // Output tax: sum of GST from bills with tax
    const billsR = await client.query(`
      SELECT
        COALESCE(SUM(bi.tax_amount), 0) AS total_gst,
        COALESCE(SUM(CASE WHEN bi.tax_rate = 0 THEN 0 ELSE bi.tax_amount END), 0) AS taxable_gst
      FROM bills b
      LEFT JOIN bill_items bi ON b.id = bi.bill_id
      WHERE b.society_id = $1
        AND b.billing_period = $2
        AND b.status NOT IN ('REJECTED')
        AND b.tax_amount > 0
    `, [req.user.society_id, period]);

    // ITC: tax component from payments (input tax credit)
    const paymentsR = await client.query(`
      SELECT
        COALESCE(SUM(b.tax_amount), 0) AS total_itc
      FROM payments p
      LEFT JOIN bills b ON p.bill_id = b.id
      WHERE b.society_id = $1
        AND TO_CHAR(p.payment_date, 'YYYY-MM') = $2
        AND p.status = 'SUCCESS'
    `, [req.user.society_id, period]);

    const totalGst = Number(billsR.rows[0].total_gst) || 0;
    const taxableGst = Number(billsR.rows[0].taxable_gst) || 0;
    const totalItc = Number(paymentsR.rows[0].total_itc) || 0;

    const totalIgst = totalGst;
    const totalCgst = taxableGst / 2;
    const totalSgst = taxableGst / 2;
    const totalCess = 0;
    const totalOutputTax = totalGst;
    const netTaxPayable = totalOutputTax - totalItc;

    return res.json({
      period,
      summary: {
        total_output_tax: parseFloat(totalOutputTax.toFixed(2)),
        total_igst: parseFloat(totalIgst.toFixed(2)),
        total_cgst: parseFloat(totalCgst.toFixed(2)),
        total_sgst: parseFloat(totalSgst.toFixed(2)),
        total_cess: totalCess,
        total_ITC: parseFloat(totalItc.toFixed(2)),
        net_tax_payable: parseFloat(netTaxPayable.toFixed(2))
      },
      generated_at: new Date().toISOString()
    });
  }).catch((err) => { console.error('getGSTR3BView error:', err); res.status(500).json({ error: 'Failed to get GSTR-3B view' }); });
};

exports.getGSTReconciliation = (req, res) => {
  if (!isPostgresEnabled || !req.user.society_id) {
    return res.status(400).json({ error: 'PostgreSQL not enabled or society not identified' });
  }
  const { period } = req.query || req.params || {};
  if (!period) {
    return res.status(400).json({ error: 'Period is required' });
  }

  return withTenant(req.user.society_id, async (client) => {
    // Get reported GST from gst_returns for the period
    const returnsR = await client.query(`
      SELECT payload
      FROM gst_returns
      WHERE society_id = $1
        AND period = $2
        AND return_type IN ('GSTR-1', 'GSTR-3B')
      ORDER BY created_at DESC
      LIMIT 1
    `, [req.user.society_id, period]);

    // Get paid GST from bills
    const billsR = await client.query(`
      SELECT COALESCE(SUM(bi.tax_amount), 0) AS total_paid_gst
      FROM bills b
      LEFT JOIN bill_items bi ON b.id = bi.bill_id
      WHERE b.society_id = $1
        AND b.billing_period = $2
        AND b.status NOT IN ('REJECTED')
        AND b.tax_amount > 0
    `, [req.user.society_id, period]);

    // Get TDS/TCS amounts that may affect reconciliation
    const tdsR = await client.query(`
      SELECT COALESCE(SUM(payload->>'tds_amount'), 0)::numeric AS total_tds
      FROM tds_returns
      WHERE society_id = $1
        AND period = $2
    `, [req.user.society_id, period]);

    const reportedPayload = returnsR.rows[0]?.payload || {};
    const totalReported = Number(reportedPayload.total_tax || 0);
    const totalPaid = Number(billsR.rows[0].total_paid_gst) || 0;
    const totalTds = Number(tdsR.rows[0]?.total_tds) || 0;
    const difference = totalReported - totalPaid;

    const details = [];
    if (difference > 0) {
      details.push({ type: 'EXCESS_CLAIM', description: 'Reported GST exceeds paid GST', amount: difference });
    } else if (difference < 0) {
      details.push({ type: 'UNDERRporting', description: 'Paid GST exceeds reported GST', amount: Math.abs(difference) });
    }
    if (totalTds > 0) {
      details.push({ type: 'TDS_ADJUSTED', description: 'TDS amount to be adjusted against GST liability', amount: totalTds });
    }

    const matchedCount = difference === 0 ? 1 : 0;
    const mismatchedCount = difference !== 0 ? 1 : 0;

    return res.json({
      period,
      matched_count: matchedCount,
      mismatched_count: mismatchedCount,
      total_reported: parseFloat(totalReported.toFixed(2)),
      total_paid: parseFloat(totalPaid.toFixed(2)),
      difference: parseFloat(difference.toFixed(2)),
      details,
      generated_at: new Date().toISOString()
    });
  }).catch((err) => { console.error('getGSTReconciliation error:', err); res.status(500).json({ error: 'Failed to get GST reconciliation' }); });
};

exports.getGSTR9View = (req, res) => {
  if (!isPostgresEnabled || !req.user.society_id) {
    return res.status(400).json({ error: 'PostgreSQL not enabled or society not identified' });
  }
  const { year } = req.query || req.params || {};
  if (!year) {
    return res.status(400).json({ error: 'Year is required' });
  }

  // Derive FY start/end from year (e.g. "2025" -> "2025-04" to "2026-03")
  const fyStart = `${year}-04-01`;
  const fyEnd = `${parseInt(year) + 1}-03-31`;

  return withTenant(req.user.society_id, async (client) => {
    const r = await client.query(`
      SELECT
        COALESCE(SUM(bi.amount), 0) AS total_taxable_supplies,
        COALESCE(SUM(CASE WHEN bi.tax_rate = 0 THEN bi.amount ELSE 0 END), 0) AS total_exempt_supplies,
        COALESCE(SUM(bi.tax_amount), 0) AS total_tax,
        COALESCE(SUM(CASE WHEN bi.tax_rate = 0 THEN 0 ELSE bi.tax_amount END), 0) AS taxable_gst,
        COALESCE(SUM(bi.tax_amount), 0) AS total_igst,
        COALESCE(SUM(CASE WHEN bi.tax_rate = 0 THEN 0 ELSE bi.tax_amount END), 0) / 2 AS total_cgst,
        COALESCE(SUM(CASE WHEN bi.tax_rate = 0 THEN 0 ELSE bi.tax_amount END), 0) / 2 AS total_sgst,
        0 AS total_cess,
        0 AS total_tds,
        0 AS total_tcs
      FROM bills b
      LEFT JOIN bill_items bi ON b.id = bi.bill_id
      WHERE b.society_id = $1
        AND b.bill_date BETWEEN $2 AND $3
        AND b.status NOT IN ('REJECTED')
    `, [req.user.society_id, fyStart, fyEnd]);

    // ITC from payments in the FY
    const itcR = await client.query(`
      SELECT COALESCE(SUM(b.tax_amount), 0) AS total_itc
      FROM payments p
      LEFT JOIN bills b ON p.bill_id = b.id
      WHERE b.society_id = $1
        AND p.payment_date BETWEEN $2 AND $3
        AND p.status = 'SUCCESS'
    `, [req.user.society_id, fyStart, fyEnd]);

    const row = r.rows[0] || {};
    const totalTaxableSupplies = Number(row.total_taxable_supplies) || 0;
    const totalExemptSupplies = Number(row.total_exempt_supplies) || 0;
    const totalTax = Number(row.total_tax) || 0;
    const taxableGst = Number(row.taxable_gst) || 0;
    const totalItc = Number(itcR.rows[0]?.total_itc) || 0;
    const netTaxPayable = totalTax - totalItc;

    return res.json({
      year,
      annual_summary: {
        total_taxable_supplies: parseFloat(totalTaxableSupplies.toFixed(2)),
        total_exempt_supplies: parseFloat(totalExemptSupplies.toFixed(2)),
        total_tax: parseFloat(totalTax.toFixed(2)),
        total_igst: parseFloat(totalTax.toFixed(2)),
        total_cgst: parseFloat((taxableGst / 2).toFixed(2)),
        total_sgst: parseFloat((taxableGst / 2).toFixed(2)),
        total_cess: 0,
        total_tds: 0,
        total_tcs: 0,
        total_ITC_availed: parseFloat(totalItc.toFixed(2)),
        net_tax_payable: parseFloat(netTaxPayable.toFixed(2))
      },
      generated_at: new Date().toISOString()
    });
  }).catch((err) => { console.error('getGSTR9View error:', err); res.status(500).json({ error: 'Failed to get GSTR-9 view' }); });
};
