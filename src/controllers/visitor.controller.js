const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled } = require('../config/postgres');

const ensureVisitorTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS visitors (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      visitor_name TEXT,
      visitor_phone TEXT,
      purpose TEXT,
      flat_id TEXT,
      visiting_member_id TEXT,
      vehicle_number TEXT,
      check_in TIMESTAMPTZ,
      check_out TIMESTAMPTZ,
      status TEXT,
      approved_by TEXT,
      guard_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getAll = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureVisitorTable(client);
        let query = 'SELECT * FROM visitors WHERE society_id = $1 ORDER BY created_at DESC';
        let params = [req.user.society_id];
        if (req.user.role === 'RESIDENT') {
          query = 'SELECT * FROM visitors WHERE society_id = $1 AND visiting_member_id = $2 ORDER BY created_at DESC';
          params.push(req.user.id);
        }
        const r = await client.query(query, params);
        return res.json({ visitors: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch visitors' }));
    }
    const db = getDb();
    let visitors;
    if (req.user.role === 'RESIDENT') {
      visitors = db.get('visitors').filter({ society_id: req.user.society_id, visiting_member_id: req.user.id }).sortBy('created_at').reverse().value();
    } else {
      visitors = db.get('visitors').filter({ society_id: req.user.society_id }).sortBy('created_at').reverse().value();
    }
    res.json({ visitors });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch visitors' });
  }
};

exports.getById = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureVisitorTable(client);
        let query = 'SELECT * FROM visitors WHERE id = $1 LIMIT 1';
        let params = [req.params.id];
        const r = await client.query(query, params);
        const visitor = r.rows[0];
        if (!visitor) return res.status(404).json({ error: 'Visitor not found' });
        if (req.user.role === 'RESIDENT' && visitor.visiting_member_id !== req.user.id) {
          return res.status(403).json({ error: 'Not authorized to view this visitor' });
        }
        return res.json({ visitor });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch visitor' }));
    }
    const db = getDb();
    const visitor = db.get('visitors').find({ id: req.params.id }).value();
    if (!visitor) return res.status(404).json({ error: 'Visitor not found' });
    if (req.user.role === 'RESIDENT' && visitor.visiting_member_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to view this visitor' });
    }
    res.json({ visitor });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch visitor' });
  }
};

exports.create = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureVisitorTable(client);
        const { visitor_name, visitor_phone, purpose, flat_id, visiting_member_id, vehicle_number } = req.body;
        const now = new Date().toISOString();
        const visitor = {
          id: uuidv4(), society_id: req.user.society_id, visitor_name,
          visitor_phone: visitor_phone || null, purpose: purpose || null, flat_id: flat_id || null,
          visiting_member_id: visiting_member_id || null, vehicle_number: vehicle_number || null,
          check_in: now, check_out: null, status: 'CHECKED_IN', approved_by: null, guard_notes: null, created_at: now
        };
        await client.query(
          `INSERT INTO visitors (id,society_id,visitor_name,visitor_phone,purpose,flat_id,visiting_member_id,vehicle_number,check_in,check_out,status,approved_by,guard_notes,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [visitor.id, visitor.society_id, visitor.visitor_name, visitor.visitor_phone, visitor.purpose, visitor.flat_id, visitor.visiting_member_id, visitor.vehicle_number, visitor.check_in, visitor.check_out, visitor.status, visitor.approved_by, visitor.guard_notes, visitor.created_at]
        );
        return res.status(201).json({ visitor });
      }).catch(() => res.status(500).json({ error: 'Failed to log visitor' }));
    }
    const db = getDb();
    const { visitor_name, visitor_phone, purpose, flat_id, visiting_member_id, vehicle_number } = req.body;
    const now = new Date().toISOString();
    const visitor = {
      id: uuidv4(), society_id: req.user.society_id, visitor_name,
      visitor_phone: visitor_phone || null, purpose: purpose || null,
      flat_id: flat_id || null, visiting_member_id: visiting_member_id || null,
      vehicle_number: vehicle_number || null, check_in: now,
      check_out: null, status: 'CHECKED_IN', approved_by: null,
      guard_notes: null, created_at: now
    };
    db.get('visitors').push(visitor).write();
    res.status(201).json({ visitor });
  } catch (error) {
    res.status(500).json({ error: 'Failed to log visitor' });
  }
};

exports.checkout = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureVisitorTable(client);
        let query = 'UPDATE visitors SET check_out = NOW(), status = $1 WHERE id = $2';
        let params = ['CHECKED_OUT', req.params.id];
        if (req.user.role === 'RESIDENT') {
          query += ' AND visiting_member_id = $3';
          params.push(req.user.id);
        }
        const result = await client.query(query, params);
        if (result.rowCount === 0) return res.status(403).json({ error: 'Not authorized or visitor not found' });
        
        const r = await client.query('SELECT * FROM visitors WHERE id = $1 LIMIT 1', [req.params.id]);
        return res.json({ visitor: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to checkout visitor' }));
    }
    const db = getDb();
    const visitor = db.get('visitors').find({ id: req.params.id }).value();
    if (!visitor) return res.status(404).json({ error: 'Visitor not found' });
    if (req.user.role === 'RESIDENT' && visitor.visiting_member_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const now = new Date().toISOString();
    db.get('visitors').find({ id: req.params.id }).assign({ check_out: now, status: 'CHECKED_OUT' }).write();
    const updatedVisitor = db.get('visitors').find({ id: req.params.id }).value();
    res.json({ visitor: updatedVisitor });
  } catch (error) {
    res.status(500).json({ error: 'Failed to checkout visitor' });
  }
};

exports.approve = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureVisitorTable(client);
        let query = 'UPDATE visitors SET status = $1, approved_by = $2 WHERE id = $3';
        let params = ['APPROVED', req.user.id, req.params.id];
        if (req.user.role === 'RESIDENT') {
          query += ' AND visiting_member_id = $4';
          params.push(req.user.id);
        }
        const result = await client.query(query, params);
        if (result.rowCount === 0) return res.status(403).json({ error: 'Not authorized or visitor not found' });
        
        const r = await client.query('SELECT * FROM visitors WHERE id = $1 LIMIT 1', [req.params.id]);
        return res.json({ visitor: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to approve visitor' }));
    }
    const db = getDb();
    const visitor = db.get('visitors').find({ id: req.params.id }).value();
    if (!visitor) return res.status(404).json({ error: 'Visitor not found' });
    if (req.user.role === 'RESIDENT' && visitor.visiting_member_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    db.get('visitors').find({ id: req.params.id }).assign({ status: 'APPROVED', approved_by: req.user.id }).write();
    const updatedVisitor = db.get('visitors').find({ id: req.params.id }).value();
    res.json({ visitor: updatedVisitor });
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve visitor' });
  }
};

exports.todayCount = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureVisitorTable(client);
        const r = await client.query(
          "SELECT COUNT(*)::int AS count FROM visitors WHERE society_id = $1 AND DATE(check_in) = CURRENT_DATE",
          [req.user.society_id]
        );
        return res.json({ count: r.rows[0]?.count || 0 });
      }).catch(() => res.status(500).json({ error: 'Failed to get count' }));
    }
    const db = getDb();
    const today = new Date().toISOString().split('T')[0];
    const count = db.get('visitors').filter(v => v.society_id === req.user.society_id && v.check_in && v.check_in.startsWith(today)).size().value();
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get count' });
  }
};

exports.generatePasscode = (req, res) => {
  try {
    const { visitor_name, visitor_phone, purpose, flat_id, valid_hours } = req.body;
    if (!visitor_name) return res.status(400).json({ error: 'Visitor name is required' });

    const passcode = Math.floor(1000 + Math.random() * 9000).toString();
    const hours = parseFloat(valid_hours) || 24;
    const validUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const id = uuidv4();

    const visitor = {
      id,
      society_id: req.user.society_id,
      visitor_name,
      visitor_phone: visitor_phone || null,
      purpose: purpose || 'Guest Visit',
      flat_id: flat_id || req.user.flat_number || 'N/A',
      visiting_member_id: req.user.id,
      vehicle_number: null,
      check_in: null,
      check_out: null,
      status: 'PRE_APPROVED',
      passcode,
      passcode_type: 'GUEST_PASS',
      valid_until: validUntil,
      approved_by: req.user.id,
      guard_notes: null,
      created_at: now
    };

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureVisitorTable(client);
        await client.query(`
          INSERT INTO visitors (
            id, society_id, visitor_name, visitor_phone, purpose, flat_id,
            visiting_member_id, status, passcode, passcode_type, valid_until,
            approved_by, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        `, [
          visitor.id, visitor.society_id, visitor.visitor_name, visitor.visitor_phone,
          visitor.purpose, visitor.flat_id, visitor.visiting_member_id, visitor.status,
          visitor.passcode, visitor.passcode_type, visitor.valid_until, visitor.approved_by
        ]);
        return res.status(201).json({ success: true, visitor });
      }).catch((err) => {
        console.error('Generate visitor passcode error:', err);
        return res.status(500).json({ error: 'Failed to generate guest pass' });
      });
    }

    const db = getDb();
    db.get('visitors').push(visitor).write();
    return res.status(201).json({ success: true, visitor });
  } catch (error) {
    return res.status(500).json({ error: 'Server error generating passcode' });
  }
};

exports.verifyPasscode = (req, res) => {
  try {
    const { passcode, flat_number } = req.body;
    if (!passcode) return res.status(400).json({ error: 'Passcode is required' });

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureVisitorTable(client);
        let q = `
          SELECT * FROM visitors 
          WHERE society_id = $1 AND passcode = $2 AND status = 'PRE_APPROVED'
        `;
        let params = [req.user.society_id, passcode.toString().trim()];
        if (flat_number) {
          params.push(flat_number.toString().trim());
          q += ` AND flat_id = $3`;
        }
        q += ' ORDER BY created_at DESC LIMIT 1';
        const r = await client.query(q, params);
        if (r.rows.length === 0) {
          return res.status(404).json({ error: 'Invalid or expired passcode' });
        }
        const visitor = r.rows[0];
        if (visitor.valid_until && new Date(visitor.valid_until) < new Date()) {
          return res.status(400).json({ error: 'This guest passcode has expired' });
        }

        // Check in visitor
        await client.query(`
          UPDATE visitors 
          SET status = 'CHECKED_IN', check_in = NOW() 
          WHERE id = $1
        `, [visitor.id]);

        return res.json({ success: true, message: 'Passcode verified! Guest checked in.', visitor: { ...visitor, status: 'CHECKED_IN' } });
      });
    }

    const db = getDb();
    const visitor = db.get('visitors').find(v => 
      v.society_id === req.user.society_id && 
      v.passcode === passcode.toString().trim() && 
      v.status === 'PRE_APPROVED'
    ).value();

    if (!visitor) return res.status(404).json({ error: 'Invalid or expired passcode' });
    if (visitor.valid_until && new Date(visitor.valid_until) < new Date()) {
      return res.status(400).json({ error: 'Passcode expired' });
    }

    db.get('visitors').find({ id: visitor.id }).assign({ status: 'CHECKED_IN', check_in: new Date().toISOString() }).write();
    return res.json({ success: true, message: 'Passcode verified! Guest checked in.', visitor: { ...visitor, status: 'CHECKED_IN' } });
  } catch (error) {
    return res.status(500).json({ error: 'Server error verifying passcode' });
  }
};

exports.getOverstaying = (req, res) => {
  try {
    const hours = parseFloat(req.query.hours) || 3;
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureVisitorTable(client);
        const q = `
          SELECT *, 
            ROUND(EXTRACT(EPOCH FROM (NOW() - check_in)) / 3600, 1) as hours_inside
          FROM visitors
          WHERE society_id = $1 
            AND status = 'CHECKED_IN'
            AND check_out IS NULL 
            AND check_in < NOW() - ($2 || ' hours')::INTERVAL
          ORDER BY check_in ASC
        `;
        const r = await client.query(q, [req.user.society_id, hours.toString()]);
        return res.json({ overstaying: r.rows });
      });
    }

    const db = getDb();
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const overstaying = (db.get('visitors').value() || [])
      .filter(v => v.society_id === req.user.society_id && v.status === 'CHECKED_IN' && !v.check_out && new Date(v.check_in).getTime() < cutoff)
      .map(v => ({
        ...v,
        hours_inside: Math.round(((Date.now() - new Date(v.check_in).getTime()) / 3600000) * 10) / 10
      }));
    return res.json({ overstaying });
  } catch (error) {
    return res.status(500).json({ error: 'Server error fetching overstaying visitors' });
  }
};

