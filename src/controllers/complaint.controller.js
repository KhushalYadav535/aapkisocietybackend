const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled } = require('../config/postgres');

const ensureComplaintTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      raised_by TEXT,
      assigned_to TEXT,
      title TEXT,
      description TEXT,
      category TEXT,
      priority TEXT,
      status TEXT,
      resolution_notes TEXT,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getAll = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureComplaintTable(client);
        let query = 'SELECT * FROM complaints ORDER BY created_at DESC';
        let params = [];
        if (req.user.role === 'RESIDENT') {
          query = 'SELECT * FROM complaints WHERE raised_by = $1 ORDER BY created_at DESC';
          params = [req.user.id];
        }
        const r = await client.query(query, params);
        return res.json({ complaints: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch complaints' }));
    }
    const db = getDb();
    let complaints;
    if (req.user.role === 'RESIDENT') {
      complaints = db.get('complaints').filter({ raised_by: req.user.id }).sortBy('created_at').reverse().value();
    } else {
      complaints = db.get('complaints').filter({ society_id: req.user.society_id }).sortBy('created_at').reverse().value();
    }
    res.json({ complaints });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch complaints' });
  }
};

exports.getById = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureComplaintTable(client);
        const r = await client.query('SELECT * FROM complaints WHERE id = $1 LIMIT 1', [req.params.id]);
        const complaint = r.rows[0];
        if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
        return res.json({ complaint });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch complaint' }));
    }
    const db = getDb();
    const complaint = db.get('complaints').find({ id: req.params.id }).value();
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    res.json({ complaint });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch complaint' });
  }
};

exports.create = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureComplaintTable(client);
        const { title, description, category, priority } = req.body;
        const now = new Date().toISOString();
        const complaint = {
          id: uuidv4(), society_id: req.user.society_id, raised_by: req.user.id,
          assigned_to: null, title, description: description || null,
          category: category || 'GENERAL', priority: priority || 'MEDIUM',
          status: 'OPEN', resolution_notes: null, resolved_at: null,
          created_at: now, updated_at: now
        };
        await client.query(
          `INSERT INTO complaints (id,society_id,raised_by,assigned_to,title,description,category,priority,status,resolution_notes,resolved_at,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [complaint.id, complaint.society_id, complaint.raised_by, complaint.assigned_to, complaint.title, complaint.description, complaint.category, complaint.priority, complaint.status, complaint.resolution_notes, complaint.resolved_at, complaint.created_at, complaint.updated_at]
        );
        return res.status(201).json({ complaint });
      }).catch(() => res.status(500).json({ error: 'Failed to create complaint' }));
    }
    const db = getDb();
    const { title, description, category, priority } = req.body;
    const now = new Date().toISOString();
    const complaint = {
      id: uuidv4(), society_id: req.user.society_id, raised_by: req.user.id,
      assigned_to: null, title, description: description || null,
      category: category || 'GENERAL', priority: priority || 'MEDIUM',
      status: 'OPEN', resolution_notes: null, resolved_at: null,
      created_at: now, updated_at: now
    };
    db.get('complaints').push(complaint).write();
    res.status(201).json({ complaint });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create complaint' });
  }
};

exports.update = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureComplaintTable(client);
        const fields = ['title', 'description', 'category', 'priority', 'status'];
        const setParts = [];
        const values = [];
        fields.forEach((f) => {
          if (req.body[f] !== undefined) {
            values.push(req.body[f]);
            setParts.push(`${f} = $${values.length}`);
          }
        });
        values.push(req.params.id);
        let idParamIdx = values.length;
        let whereClause = `id = $${idParamIdx}`;
        if (req.user.role === 'RESIDENT') {
          values.push(req.user.id);
          whereClause += ` AND raised_by = $${values.length}`;
        }
        const setClause = setParts.length ? `${setParts.join(', ')}, updated_at = NOW()` : 'updated_at = NOW()';
        
        const result = await client.query(`UPDATE complaints SET ${setClause} WHERE ${whereClause}`, values);
        if (result.rowCount === 0) return res.status(403).json({ error: 'Not authorized or complaint not found' });
        
        const r = await client.query('SELECT * FROM complaints WHERE id = $1 LIMIT 1', [req.params.id]);
        return res.json({ complaint: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to update complaint' }));
    }
    const db = getDb();
    const complaint = db.get('complaints').find({ id: req.params.id }).value();
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    if (req.user.role === 'RESIDENT' && complaint.raised_by !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const updates = {};
    ['title', 'description', 'category', 'priority', 'status'].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    updates.updated_at = new Date().toISOString();
    db.get('complaints').find({ id: req.params.id }).assign(updates).write();
    const complaint = db.get('complaints').find({ id: req.params.id }).value();
    res.json({ complaint });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update complaint' });
  }
};

exports.assign = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureComplaintTable(client);
        const { assigned_to } = req.body;
        await client.query('UPDATE complaints SET assigned_to = $1, status = $2, updated_at = NOW() WHERE id = $3', [assigned_to, 'IN_PROGRESS', req.params.id]);
        const r = await client.query('SELECT * FROM complaints WHERE id = $1 LIMIT 1', [req.params.id]);
        return res.json({ complaint: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to assign complaint' }));
    }
    const db = getDb();
    const { assigned_to } = req.body;
    db.get('complaints').find({ id: req.params.id }).assign({ assigned_to, status: 'IN_PROGRESS', updated_at: new Date().toISOString() }).write();
    const complaint = db.get('complaints').find({ id: req.params.id }).value();
    res.json({ complaint });
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign complaint' });
  }
};

exports.resolve = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureComplaintTable(client);
        const { resolution_notes } = req.body;
        await client.query(
          'UPDATE complaints SET status = $1, resolution_notes = $2, resolved_at = NOW(), updated_at = NOW() WHERE id = $3',
          ['RESOLVED', resolution_notes || 'Resolved', req.params.id]
        );
        const r = await client.query('SELECT * FROM complaints WHERE id = $1 LIMIT 1', [req.params.id]);
        return res.json({ complaint: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to resolve complaint' }));
    }
    const db = getDb();
    const { resolution_notes } = req.body;
    const now = new Date().toISOString();
    db.get('complaints').find({ id: req.params.id }).assign({ status: 'RESOLVED', resolution_notes: resolution_notes || 'Resolved', resolved_at: now, updated_at: now }).write();
    const complaint = db.get('complaints').find({ id: req.params.id }).value();
    res.json({ complaint });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resolve complaint' });
  }
};

exports.close = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureComplaintTable(client);
        let query = 'UPDATE complaints SET status = $1, updated_at = NOW() WHERE id = $2';
        let params = ['CLOSED', req.params.id];
        if (req.user.role === 'RESIDENT') {
          query += ' AND raised_by = $3';
          params.push(req.user.id);
        }
        const result = await client.query(query, params);
        if (result.rowCount === 0) return res.status(403).json({ error: 'Not authorized or complaint not found' });
        
        const r = await client.query('SELECT * FROM complaints WHERE id = $1 LIMIT 1', [req.params.id]);
        return res.json({ complaint: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to close complaint' }));
    }
    const db = getDb();
    const complaint = db.get('complaints').find({ id: req.params.id }).value();
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    if (req.user.role === 'RESIDENT' && complaint.raised_by !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    db.get('complaints').find({ id: req.params.id }).assign({ status: 'CLOSED', updated_at: new Date().toISOString() }).write();
    const complaint = db.get('complaints').find({ id: req.params.id }).value();
    res.json({ complaint });
  } catch (error) {
    res.status(500).json({ error: 'Failed to close complaint' });
  }
};
