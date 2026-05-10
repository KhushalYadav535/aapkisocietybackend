const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, ensurePlatformSchema } = require('../config/postgres');

const ensureMeetingTables = async (societyId) => {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS society_${societyId}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS society_${societyId}.meetings (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      title TEXT,
      description TEXT,
      meeting_type TEXT DEFAULT 'AGM',
      status TEXT DEFAULT 'SCHEDULED',
      convened_by TEXT,
      meeting_date DATE,
      start_time TEXT,
      end_time TEXT,
      location TEXT,
      agenda_items JSONB,
      is_online BOOLEAN DEFAULT false,
      meeting_link TEXT,
      minutes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS society_${societyId}.polls (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      meeting_id TEXT,
      title TEXT,
      description TEXT,
      poll_type TEXT DEFAULT 'OPEN',
      options JSONB,
      total_votes INTEGER DEFAULT 0,
      end_date DATE,
      min_votes_required INTEGER DEFAULT 1,
      status TEXT DEFAULT 'ACTIVE',
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS society_${societyId}.poll_votes (
      id TEXT PRIMARY KEY,
      poll_id TEXT,
      user_id TEXT,
      option_id TEXT,
      voted_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getMeetings = (req, res) => {
  try {
    const { status } = req.query;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensurePlatformSchema().then(async () => {
        let query = `SELECT m.*, u.first_name, u.last_name FROM society_${societyId}.meetings m JOIN platform.users u ON u.id = m.convened_by WHERE m.society_id = $1`;
        const params = [societyId];
        if (status) { query += ` AND m.status = $2`; params.push(status); }
        query += ' ORDER BY m.meeting_date DESC, m.start_time DESC';
        const r = await pool.query(query, params);
        return res.json({ meetings: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch meetings' }));
    }

    const db = getDb();
    const users = db.get('users').value();
    let meetings = (db.get('meetings') || []).filter(m => m.society_id === societyId);
    if (status) meetings = meetings.filter(m => m.status === status);

    const withConvener = meetings.map(m => {
      const convener = users.find(u => u.id === m.convened_by);
      return { ...m, first_name: convener?.first_name, last_name: convener?.last_name };
    });

    res.json({ meetings: withConvener.sort((a, b) => new Date(b.meeting_date) - new Date(a.meeting_date)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
};

exports.create = (req, res) => {
  try {
    const { title, description, meeting_type, meeting_date, start_time, end_time, location, agenda_items, is_online, meeting_link } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (!['ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'].includes(req.user.role)) return res.status(403).json({ error: 'Only committee can convene meetings' });

    const meeting = {
      id: uuidv4(), society_id: societyId, title, description,
      meeting_type: meeting_type || 'AGM', status: 'SCHEDULED',
      convened_by: req.user.id, meeting_date, start_time, end_time,
      location, agenda_items: agenda_items || [], is_online: is_online || false, meeting_link,
      created_at: now, updated_at: now
    };

    if (isPostgresEnabled) {
      return ensurePlatformSchema().then(async () => {
        await pool.query(
          `INSERT INTO society_${societyId}.meetings (id, society_id, title, description, meeting_type, status, convened_by, meeting_date, start_time, end_time, location, agenda_items, is_online, meeting_link, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [meeting.id, meeting.society_id, meeting.title, meeting.description, meeting.meeting_type, meeting.status, meeting.convened_by, meeting.meeting_date, meeting.start_time, meeting.end_time, meeting.location, meeting.agenda_items, meeting.is_online, meeting.meeting_link, meeting.created_at]
        );
        return res.status(201).json({ meeting });
      }).catch(() => res.status(500).json({ error: 'Failed to create meeting' }));
    }

    const db = getDb();
    if (!db.get('meetings').value()) db.set('meetings', []).write();
    db.get('meetings').push(meeting).write();
    res.status(201).json({ meeting });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create meeting' });
  }
};

exports.getById = (req, res) => {
  try {
    const { id } = req.params;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureMeetingTables(societyId).then(async () => {
        const r = await pool.query(`SELECT m.*, u.first_name, u.last_name FROM society_${societyId}.meetings m JOIN platform.users u ON u.id = m.convened_by WHERE m.id = $1`, [id]);
        if (!r.rows[0]) return res.status(404).json({ error: 'Meeting not found' });
        return res.json({ meeting: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch meeting' }));
    }

    const db = getDb();
    const users = db.get('users').value();
    const meeting = (db.get('meetings') || []).find(m => m.id === id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const convener = users.find(u => u.id === meeting.convened_by);
    res.json({ meeting: { ...meeting, first_name: convener?.first_name, last_name: convener?.last_name } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch meeting' });
  }
};

exports.updateStatus = (req, res) => {
  try {
    const { id } = req.params;
    const { status, minutes } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    const VALID_TRANSITIONS = { SCHEDULED: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['COMPLETED', 'CANCELLED'], COMPLETED: [] };
    if (!VALID_TRANSITIONS[req.body.currentStatus]?.includes(status)) {
      return res.status(400).json({ error: 'Invalid status transition' });
    }

    if (isPostgresEnabled) {
      return ensureMeetingTables(societyId).then(async () => {
        await pool.query(
          `UPDATE society_${societyId}.meetings SET status = $1, minutes = COALESCE($2, minutes), updated_at = $3 WHERE id = $4`,
          [status, minutes, now, id]
        );
        const r = await pool.query(`SELECT * FROM society_${societyId}.meetings WHERE id = $1`, [id]);
        return res.json({ meeting: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to update meeting' }));
    }

    const db = getDb();
    db.get('meetings').find({ id }).assign({ status, minutes: minutes || db.get('meetings').find({ id }).value()?.minutes, updated_at: now }).write();
    res.json({ meeting: db.get('meetings').find({ id }).value() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update meeting' });
  }
};

// Polls/Voting
exports.createPoll = (req, res) => {
  try {
    const { meeting_id, title, description, options, poll_type, end_date, min_votes_required } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    const poll = {
      id: uuidv4(), society_id: societyId, meeting_id,
      title, description, poll_type: poll_type || 'OPEN',
      options: options.map((o, i) => ({ id: uuidv4(), text: o, votes: 0 })),
      total_votes: 0, end_date, min_votes_required: min_votes_required || 1,
      status: 'ACTIVE', created_by: req.user.id, created_at: now
    };

    if (isPostgresEnabled) {
      return ensureMeetingTables(societyId).then(async () => {
        await pool.query(
          `INSERT INTO society_${societyId}.polls (id, society_id, meeting_id, title, description, poll_type, options, total_votes, end_date, min_votes_required, status, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [poll.id, poll.society_id, poll.meeting_id, poll.title, poll.description, poll.poll_type, JSON.stringify(poll.options), poll.total_votes, poll.end_date, poll.min_votes_required, poll.status, poll.created_by, poll.created_at]
        );
        return res.status(201).json({ poll });
      }).catch(() => res.status(500).json({ error: 'Failed to create poll' }));
    }

    const db2 = getDb();
    if (!db2.get('polls').value()) db2.set('polls', []).write();
    db2.get('polls').push(poll).write();
    res.status(201).json({ poll });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create poll' });
  }
};

exports.vote = (req, res) => {
  try {
    const { id } = req.params;
    const { option_id } = req.body;
    const userId = req.user.id;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      return ensureMeetingTables(societyId).then(async () => {
        const existing = await pool.query(`SELECT * FROM society_${societyId}.poll_votes WHERE poll_id = $1 AND user_id = $2`, [id, userId]);
        if (existing.rows.length > 0) return res.status(400).json({ error: 'Already voted' });

        const poll = await pool.query(`SELECT * FROM society_${societyId}.polls WHERE id = $1`, [id]);
        if (!poll.rows[0]) return res.status(404).json({ error: 'Poll not found' });
        if (poll.rows[0].status !== 'ACTIVE') return res.status(400).json({ error: 'Poll is not active' });

        let options = typeof poll.rows[0].options === 'string' ? JSON.parse(poll.rows[0].options) : poll.rows[0].options;
        options = options.map(o => {
          if (o.id === option_id) return { ...o, votes: (o.votes || 0) + 1 };
          return o;
        });

        await pool.query(`UPDATE society_${societyId}.polls SET options = $1, total_votes = total_votes + 1 WHERE id = $2`, [JSON.stringify(options), id]);
        await pool.query(`INSERT INTO society_${societyId}.poll_votes (id, poll_id, user_id, option_id, voted_at) VALUES ($1, $2, $3, $4, $5)`, [uuidv4(), id, userId, option_id, now]);

        const updated = await pool.query(`SELECT * FROM society_${societyId}.polls WHERE id = $1`, [id]);
        return res.json({ poll: updated.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to vote' }));
    }

    const db = getDb();
    const polls = db.get('polls').value() || [];
    const poll = polls.find(p => p.id === id);
    if (!poll) return res.status(404).json({ error: 'Poll not found' });
    if (poll.status !== 'ACTIVE') return res.status(400).json({ error: 'Poll is not active' });

    const pollVotes = db.get('poll_votes').value() || [];
    const alreadyVoted = pollVotes.some(v => v.poll_id === id && v.user_id === userId);
    if (alreadyVoted) return res.status(400).json({ error: 'Already voted' });

    poll.options = poll.options.map(o => {
      if (o.id === option_id) return { ...o, votes: (o.votes || 0) + 1 };
      return o;
    });
    poll.total_votes = (poll.total_votes || 0) + 1;

    db.get('polls').find({ id }).assign({ options: poll.options, total_votes: poll.total_votes }).write();

    if (!db.get('poll_votes').value()) db.set('poll_votes', []).write();
    db.get('poll_votes').push({ id: uuidv4(), poll_id: id, user_id: userId, option_id, voted_at: now }).write();

    res.json({ poll });
  } catch (error) {
    res.status(500).json({ error: 'Failed to vote' });
  }
};

exports.getPolls = (req, res) => {
  try {
    const { meeting_id, status } = req.query;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureMeetingTables(societyId).then(async () => {
        let query = `SELECT * FROM society_${societyId}.polls WHERE society_id = $1`;
        const params = [societyId];
        let idx = 2;
        if (meeting_id) { query += ` AND meeting_id = $${idx++}`; params.push(meeting_id); }
        if (status) { query += ` AND status = $${idx++}`; params.push(status); }
        query += ' ORDER BY created_at DESC';
        const r = await pool.query(query, params);
        return res.json({ polls: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch polls' }));
    }

    const db = getDb();
    let polls = db.get('polls').value() || [];
    polls = polls.filter(p => p.society_id === societyId);
    if (meeting_id) polls = polls.filter(p => p.meeting_id === meeting_id);
    if (status) polls = polls.filter(p => p.status === status);
    res.json({ polls: polls.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch polls' });
  }
};

exports.closePoll = (req, res) => {
  try {
    const { id } = req.params;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (!['ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'].includes(req.user.role)) return res.status(403).json({ error: 'Not authorized' });

    if (isPostgresEnabled) {
      return ensureMeetingTables(societyId).then(async () => {
        await pool.query(`UPDATE society_${societyId}.polls SET status = 'CLOSED', updated_at = $1 WHERE id = $2`, [now, id]);
        const r = await pool.query(`SELECT * FROM society_${societyId}.polls WHERE id = $1`, [id]);
        return res.json({ poll: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to close poll' }));
    }

    const db = getDb();
    db.get('polls').find({ id }).assign({ status: 'CLOSED', updated_at: now }).write();
    res.json({ poll: db.get('polls').find({ id }).value() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to close poll' });
  }
};