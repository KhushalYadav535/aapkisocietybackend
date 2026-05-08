const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled } = require('../config/postgres');

const ensureNoticeTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS notices (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      title TEXT,
      content TEXT,
      category TEXT,
      priority TEXT,
      published_by TEXT,
      is_published INTEGER DEFAULT 0,
      publish_date TIMESTAMPTZ,
      expiry_date DATE,
      attachment_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getAll = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureNoticeTable(client);
        let query = 'SELECT * FROM notices WHERE society_id = $1 ORDER BY created_at DESC';
        let params = [req.user.society_id];
        if (req.user.role === 'RESIDENT') {
          query = 'SELECT * FROM notices WHERE society_id = $1 AND is_published = 1 ORDER BY publish_date DESC';
        }
        const r = await client.query(query, params);
        return res.json({ notices: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch notices' }));
    }
    const db = getDb();
    let notices;
    if (req.user.role === 'RESIDENT') {
      notices = db.get('notices').filter({ society_id: req.user.society_id, is_published: 1 }).sortBy('publish_date').reverse().value();
    } else {
      notices = db.get('notices').filter({ society_id: req.user.society_id }).sortBy('created_at').reverse().value();
    }
    res.json({ notices });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notices' });
  }
};

exports.getById = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureNoticeTable(client);
        const r = await client.query('SELECT * FROM notices WHERE id = $1 LIMIT 1', [req.params.id]);
        const notice = r.rows[0];
        if (!notice) return res.status(404).json({ error: 'Notice not found' });
        if (req.user.role === 'RESIDENT' && !Number(notice.is_published)) {
          return res.status(404).json({ error: 'Notice not found' });
        }
        return res.json({ notice });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch notice' }));
    }
    const db = getDb();
    const notice = db.get('notices').find({ id: req.params.id }).value();
    if (!notice) return res.status(404).json({ error: 'Notice not found' });
    if (req.user.role === 'RESIDENT' && !notice.is_published) {
      return res.status(404).json({ error: 'Notice not found' });
    }
    res.json({ notice });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notice' });
  }
};

exports.create = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureNoticeTable(client);
        const { title, content, category, priority, expiry_date } = req.body;
        const now = new Date().toISOString();
        const notice = {
          id: uuidv4(), society_id: req.user.society_id, title, content,
          category: category || 'GENERAL', priority: priority || 'NORMAL',
          published_by: req.user.id, is_published: 1, publish_date: now,
          expiry_date: expiry_date || null, attachment_url: null,
          created_at: now, updated_at: now
        };
        await client.query(
          `INSERT INTO notices (id,society_id,title,content,category,priority,published_by,is_published,publish_date,expiry_date,attachment_url,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [notice.id, notice.society_id, notice.title, notice.content, notice.category, notice.priority, notice.published_by, notice.is_published, notice.publish_date, notice.expiry_date, notice.attachment_url, notice.created_at, notice.updated_at]
        );
        return res.status(201).json({ notice });
      }).catch(() => res.status(500).json({ error: 'Failed to create notice' }));
    }
    const db = getDb();
    const { title, content, category, priority, expiry_date } = req.body;
    const now = new Date().toISOString();
    const notice = {
      id: uuidv4(), society_id: req.user.society_id, title, content,
      category: category || 'GENERAL', priority: priority || 'NORMAL',
      published_by: req.user.id, is_published: 1, publish_date: now,
      expiry_date: expiry_date || null, attachment_url: null,
      created_at: now, updated_at: now
    };
    db.get('notices').push(notice).write();
    res.status(201).json({ notice });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create notice' });
  }
};

exports.update = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureNoticeTable(client);
        const fields = ['title', 'content', 'category', 'priority', 'expiry_date'];
        const setParts = [];
        const values = [];
        fields.forEach((f) => {
          if (req.body[f] !== undefined) {
            values.push(req.body[f]);
            setParts.push(`${f} = $${values.length}`);
          }
        });
        values.push(req.params.id);
        const setClause = setParts.length ? `${setParts.join(', ')}, updated_at = NOW()` : 'updated_at = NOW()';
        await client.query(`UPDATE notices SET ${setClause} WHERE id = $${values.length}`, values);
        const r = await client.query('SELECT * FROM notices WHERE id = $1 LIMIT 1', [req.params.id]);
        return res.json({ notice: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to update notice' }));
    }
    const db = getDb();
    const updates = {};
    ['title', 'content', 'category', 'priority', 'expiry_date'].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    updates.updated_at = new Date().toISOString();
    db.get('notices').find({ id: req.params.id }).assign(updates).write();
    const notice = db.get('notices').find({ id: req.params.id }).value();
    res.json({ notice });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update notice' });
  }
};

exports.publish = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureNoticeTable(client);
        await client.query('UPDATE notices SET is_published = 1, publish_date = NOW(), updated_at = NOW() WHERE id = $1', [req.params.id]);
        const r = await client.query('SELECT * FROM notices WHERE id = $1 LIMIT 1', [req.params.id]);
        return res.json({ notice: r.rows[0], message: 'Notice published' });
      }).catch(() => res.status(500).json({ error: 'Failed to publish notice' }));
    }
    const db = getDb();
    const now = new Date().toISOString();
    db.get('notices').find({ id: req.params.id }).assign({ is_published: 1, publish_date: now, updated_at: now }).write();
    const notice = db.get('notices').find({ id: req.params.id }).value();
    res.json({ notice, message: 'Notice published' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to publish notice' });
  }
};

exports.remove = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureNoticeTable(client);
        await client.query('DELETE FROM notices WHERE id = $1', [req.params.id]);
        return res.json({ message: 'Notice deleted' });
      }).catch(() => res.status(500).json({ error: 'Failed to delete notice' }));
    }
    const db = getDb();
    db.get('notices').remove({ id: req.params.id }).write();
    res.json({ message: 'Notice deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete notice' });
  }
};
