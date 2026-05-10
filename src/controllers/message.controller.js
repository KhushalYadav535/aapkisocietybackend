const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, ensurePlatformSchema } = require('../config/postgres');

const ensureMessageTables = async (societyId) => {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS society_${societyId}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS society_${societyId}.messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      sender_id TEXT,
      receiver_id TEXT,
      content TEXT,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getConversations = (req, res) => {
  try {
    const userId = req.user.id;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureMessageTables(societyId).then(async () => {
        const r = await pool.query(`
          SELECT DISTINCT ON (c.conversation_id)
            c.*,
            CASE WHEN c.sender_id = $1 THEN r.first_name ELSE s.first_name END as other_name,
            CASE WHEN c.sender_id = $1 THEN r.last_name ELSE s.last_name END as other_last_name,
            CASE WHEN c.sender_id = $1 THEN r.flat_number ELSE s.flat_number END as other_flat,
            CASE WHEN c.sender_id = $1 THEN r.wing ELSE s.wing END as other_wing
          FROM society_${societyId}.messages c
          JOIN platform.users s ON s.id = c.sender_id
          JOIN platform.users r ON r.id = c.receiver_id
          WHERE c.conversation_id IN (
            SELECT conversation_id FROM society_${societyId}.messages
            WHERE sender_id = $1 OR receiver_id = $1
          )
          ORDER BY c.conversation_id, c.created_at DESC
        `, [userId]);
        return res.json({ conversations: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch conversations' }));
    }

    const db = getDb();
    const messages = db.get('messages') || [];
    const users = db.get('users') || [];

    const convMap = {};
    messages.forEach(m => {
      if (m.sender_id !== userId && m.receiver_id !== userId) return;
      const otherId = m.sender_id === userId ? m.receiver_id : m.sender_id;
      if (!convMap[m.conversation_id]) {
        const other = users.find(u => u.id === otherId);
        convMap[m.conversation_id] = {
          conversation_id: m.conversation_id,
          last_message: m.content,
          last_message_at: m.created_at,
          unread_count: 0,
          other_name: other?.first_name,
          other_last_name: other?.last_name,
          other_flat: other?.flat_number,
          other_wing: other?.wing
        };
      }
      if (m.receiver_id === userId && !m.read_at) {
        convMap[m.conversation_id].unread_count = (convMap[m.conversation_id].unread_count || 0) + 1;
      }
    });

    const conversations = Object.values(convMap).sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
    res.json({ conversations });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
};

exports.getMessages = (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureMessageTables(societyId).then(async () => {
        const r = await pool.query(`
          SELECT m.*, s.first_name as sender_name, s.last_name as sender_last_name, s.flat_number as sender_flat, s.wing as sender_wing
          FROM society_${societyId}.messages m
          JOIN platform.users s ON s.id = m.sender_id
          WHERE m.conversation_id = $1
          ORDER BY m.created_at DESC
          LIMIT $2 OFFSET $3
        `, [conversationId, limit, offset]);

        await pool.query(`
          UPDATE society_${societyId}.messages SET read_at = NOW()
          WHERE conversation_id = $1 AND receiver_id = $2 AND read_at IS NULL
        `, [conversationId, userId]);

        return res.json({ messages: r.rows.reverse() });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch messages' }));
    }

    const db = getDb();
    let messages = (db.get('messages') || []).filter(m => m.conversation_id === conversationId);
    const users = db.get('users') || [];

    messages = messages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const paginated = messages.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    const withSender = paginated.map(m => {
      const sender = users.find(u => u.id === m.sender_id);
      return { ...m, sender_name: sender?.first_name, sender_last_name: sender?.last_name, sender_flat: sender?.flat_number, sender_wing: sender?.wing };
    }).reverse();

    db.get('messages').filter(m => m.conversation_id === conversationId && m.receiver_id === userId && !m.read_at)
      .forEach(m => { m.read_at = new Date().toISOString(); });
    db.write();

    res.json({ messages: withSender });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
};

exports.send = (req, res) => {
  try {
    const { receiver_id, content } = req.body;
    const senderId = req.user.id;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (!content || !content.trim()) return res.status(400).json({ error: 'Message cannot be empty' });
    if (receiver_id === senderId) return res.status(400).json({ error: 'Cannot send message to yourself' });

    const convId = [senderId, receiver_id].sort().join('-');

    const message = {
      id: uuidv4(), conversation_id: convId, sender_id: senderId, receiver_id,
      content: content.trim(), read_at: null,
      created_at: now
    };

    if (isPostgresEnabled) {
      return ensureMessageTables(societyId).then(async () => {
        await pool.query(
          `INSERT INTO society_${societyId}.messages (id, conversation_id, sender_id, receiver_id, content, read_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [message.id, message.conversation_id, message.sender_id, message.receiver_id, message.content, message.read_at, message.created_at]
        );

        const sender = await pool.query(`SELECT first_name, last_name, flat_number, wing FROM platform.users WHERE id = $1`, [senderId]);
        return res.status(201).json({ message: { ...message, sender_name: sender.rows[0]?.first_name, sender_last_name: sender.rows[0]?.last_name, sender_flat: sender.rows[0]?.flat_number, sender_wing: sender.rows[0]?.wing } });
      }).catch(() => res.status(500).json({ error: 'Failed to send message' }));
    }

    const db = getDb();
    if (!db.get('messages').value()) db.set('messages', []).write();
    db.get('messages').push(message).write();

    const sender = db.get('users').find(u => u.id === senderId).value();
    res.status(201).json({ message: { ...message, sender_name: sender?.first_name, sender_last_name: sender?.last_name, sender_flat: sender?.flat_number, sender_wing: sender?.wing } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message' });
  }
};

exports.getUnreadCount = (req, res) => {
  try {
    const userId = req.user.id;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureMessageTables(societyId).then(async () => {
        const r = await pool.query(
          `SELECT COUNT(*) as count FROM society_${societyId}.messages WHERE receiver_id = $1 AND read_at IS NULL`,
          [userId]
        );
        return res.json({ count: parseInt(r.rows[0]?.count || 0) });
      }).catch(() => res.status(500).json({ error: 'Failed to get unread count' }));
    }

    const db = getDb();
    const count = (db.get('messages') || []).filter(m => m.receiver_id === userId && !m.read_at).length;
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get unread count' });
  }
};