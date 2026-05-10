const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, ensurePlatformSchema } = require('../config/postgres');

exports.markRead = (req, res) => {
  try {
    const { notice_id } = req.body;
    const userId = req.user.id;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      return ensurePlatformSchema().then(async () => {
        const existing = await pool.query(
          `SELECT * FROM society_${societyId}.notice_reads WHERE notice_id = $1 AND user_id = $2`,
          [notice_id, userId]
        );
        if (existing.rows.length > 0) {
          await pool.query(`UPDATE society_${societyId}.notice_reads SET read_at = $1 WHERE notice_id = $2 AND user_id = $3`, [now, notice_id, userId]);
        } else {
          const id = uuidv4();
          await pool.query(
            `INSERT INTO society_${societyId}.notice_reads (id, notice_id, user_id, read_at) VALUES ($1, $2, $3, $4)`,
            [id, notice_id, userId, now]
          );
        }
        return res.json({ message: 'Notice marked as read' });
      }).catch(() => res.status(500).json({ error: 'Failed to mark as read' }));
    }

    const db = getDb();
    if (!db.get('notice_reads')) db.set('notice_reads', []);

    const existing = db.get('notice_reads').find(r => r.notice_id === notice_id && r.user_id === userId).value();

    if (existing) {
      db.get('notice_reads').find({ notice_id, user_id: userId }).assign({ read_at: now }).write();
    } else {
      db.get('notice_reads').push({ id: uuidv4(), notice_id, user_id: userId, society_id: societyId, read_at: now }).write();
    }

    res.json({ message: 'Notice marked as read' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark as read' });
  }
};

exports.getReadReceipts = (req, res) => {
  try {
    const { notice_id } = req.params;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensurePlatformSchema().then(async () => {
        const r = await pool.query(`
          SELECT nr.*, u.first_name, u.last_name, u.flat_number, u.wing
          FROM society_${societyId}.notice_reads nr
          JOIN platform.users u ON u.id = nr.user_id
          WHERE nr.notice_id = $1
          ORDER BY nr.read_at DESC
        `, [notice_id]);
        return res.json({ receipts: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch receipts' }));
    }

    const db = getDb();
    const reads = db.get('notice_reads') ? db.get('notice_reads').filter(r => r.notice_id === notice_id).value() : [];
    const users = db.get('users').value();

    const receipts = reads.map(r => {
      const user = users.find(u => u.id === r.user_id);
      return { ...r, first_name: user?.first_name, last_name: user?.last_name, flat_number: user?.flat_number, wing: user?.wing };
    });

    res.json({ receipts: receipts.sort((a, b) => new Date(b.read_at) - new Date(a.read_at)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
};

exports.getMyUnread = (req, res) => {
  try {
    const userId = req.user.id;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensurePlatformSchema().then(async () => {
        const notices = await pool.query(`
          SELECT n.id, n.title, n.category, n.priority, n.publish_date
          FROM society_${societyId}.notices n
          WHERE n.is_published = 1
          AND n.id NOT IN (SELECT notice_id FROM society_${societyId}.notice_reads WHERE user_id = $1)
          ORDER BY n.publish_date DESC
          LIMIT 10
        `, [userId]);
        return res.json({ unread: notices.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch unread notices' }));
    }

    const db = getDb();
    const notices = db.get('notices') ? db.get('notices').filter(n => n.is_published && n.is_published === 1).value() : [];
    const reads = db.get('notice_reads') ? db.get('notice_reads').filter(r => r.user_id === userId).value() : [];
    const readIds = reads.map(r => r.notice_id);

    const unread = notices.filter(n => !readIds.includes(n.id)).slice(0, 10);
    res.json({ unread });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch unread notices' });
  }
};