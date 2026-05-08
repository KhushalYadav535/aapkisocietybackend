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
    const visitor = db.get('visitors').find({ id: req.params.id }).value();
    res.json({ visitor });
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
    const visitor = db.get('visitors').find({ id: req.params.id }).value();
    res.json({ visitor });
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
