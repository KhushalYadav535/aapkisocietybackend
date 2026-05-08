const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled } = require('../config/postgres');

const ensureNotificationTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      channel TEXT,
      recipients JSONB DEFAULT '[]'::jsonb,
      template_key TEXT,
      subject TEXT,
      body TEXT,
      status TEXT,
      sent_at TIMESTAMPTZ,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.list = (req, res) => {
  if (isPostgresEnabled && req.user.society_id) {
    return withTenant(req.user.society_id, async (client) => {
      await ensureNotificationTable(client);
      const r = await client.query('SELECT * FROM notifications WHERE society_id = $1 ORDER BY created_at DESC', [req.user.society_id]);
      return res.json({ notifications: r.rows });
    }).catch(() => res.status(500).json({ error: 'Failed to fetch notifications' }));
  }
  const db = getDb();
  const notifications = db.get('notifications').filter({ society_id: req.user.society_id }).sortBy('created_at').reverse().value();
  res.json({ notifications });
};

exports.send = (req, res) => {
  if (isPostgresEnabled && req.user.society_id) {
    return withTenant(req.user.society_id, async (client) => {
      await ensureNotificationTable(client);
      const now = new Date().toISOString();
      const channel = req.body.channel || 'EMAIL';
      const notification = {
        id: uuidv4(),
        society_id: req.user.society_id,
        channel,
        recipients: req.body.recipients || [],
        template_key: req.body.template_key || 'custom',
        subject: req.body.subject || null,
        body: req.body.body || '',
        status: 'SENT',
        sent_at: now,
        created_by: req.user.id,
        created_at: now
      };
      await client.query(
        `INSERT INTO notifications (id,society_id,channel,recipients,template_key,subject,body,status,sent_at,created_by,created_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11)`,
        [notification.id, notification.society_id, notification.channel, JSON.stringify(notification.recipients), notification.template_key, notification.subject, notification.body, notification.status, notification.sent_at, notification.created_by, notification.created_at]
      );
      return res.status(201).json({ notification });
    }).catch(() => res.status(500).json({ error: 'Failed to send notification' }));
  }
  const db = getDb();
  const now = new Date().toISOString();
  const channel = req.body.channel || 'EMAIL';
  const notification = {
    id: uuidv4(),
    society_id: req.user.society_id,
    channel,
    recipients: req.body.recipients || [],
    template_key: req.body.template_key || 'custom',
    subject: req.body.subject || null,
    body: req.body.body || '',
    status: 'SENT',
    sent_at: now,
    created_by: req.user.id,
    created_at: now
  };
  db.get('notifications').push(notification).write();
  res.status(201).json({ notification });
};
