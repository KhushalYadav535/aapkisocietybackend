const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled } = require('../config/postgres');

const ensureComplianceTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS compliance_events (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      type TEXT,
      title TEXT,
      due_date DATE,
      status TEXT,
      lead_days INTEGER DEFAULT 3,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getCalendar = (req, res) => {
  if (isPostgresEnabled && req.user.society_id) {
    return withTenant(req.user.society_id, async (client) => {
      await ensureComplianceTable(client);
      const r = await client.query('SELECT * FROM compliance_events WHERE society_id = $1 ORDER BY due_date ASC', [req.user.society_id]);
      return res.json({ events: r.rows });
    }).catch(() => res.status(500).json({ error: 'Failed to fetch compliance events' }));
  }
  const db = getDb();
  const events = db.get('compliance_events').filter({ society_id: req.user.society_id }).sortBy('due_date').value();
  res.json({ events });
};

exports.addEvent = (req, res) => {
  if (isPostgresEnabled && req.user.society_id) {
    return withTenant(req.user.society_id, async (client) => {
      await ensureComplianceTable(client);
      const now = new Date().toISOString();
      const event = {
        id: uuidv4(),
        society_id: req.user.society_id,
        type: req.body.type,
        title: req.body.title,
        due_date: req.body.due_date,
        status: req.body.status || 'PENDING',
        lead_days: Number(req.body.lead_days || 3),
        created_at: now,
        updated_at: now
      };
      await client.query(
        `INSERT INTO compliance_events (id,society_id,type,title,due_date,status,lead_days,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [event.id, event.society_id, event.type, event.title, event.due_date, event.status, event.lead_days, event.created_at, event.updated_at]
      );
      return res.status(201).json({ event });
    }).catch(() => res.status(500).json({ error: 'Failed to create compliance event' }));
  }
  const db = getDb();
  const now = new Date().toISOString();
  const event = {
    id: uuidv4(),
    society_id: req.user.society_id,
    type: req.body.type,
    title: req.body.title,
    due_date: req.body.due_date,
    status: req.body.status || 'PENDING',
    lead_days: Number(req.body.lead_days || 3),
    created_at: now,
    updated_at: now
  };
  db.get('compliance_events').push(event).write();
  res.status(201).json({ event });
};

exports.updateEvent = (req, res) => {
  if (isPostgresEnabled && req.user.society_id) {
    return withTenant(req.user.society_id, async (client) => {
      await ensureComplianceTable(client);
      await client.query('UPDATE compliance_events SET status = $1, updated_at = NOW() WHERE id = $2', [req.body.status, req.params.id]);
      const r = await client.query('SELECT * FROM compliance_events WHERE id = $1 LIMIT 1', [req.params.id]);
      const event = r.rows[0];
      if (!event) return res.status(404).json({ error: 'Event not found' });
      return res.json({ event });
    }).catch(() => res.status(500).json({ error: 'Failed to update compliance event' }));
  }
  const db = getDb();
  db.get('compliance_events').find({ id: req.params.id }).assign({
    status: req.body.status,
    updated_at: new Date().toISOString()
  }).write();
  const event = db.get('compliance_events').find({ id: req.params.id }).value();
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json({ event });
};
