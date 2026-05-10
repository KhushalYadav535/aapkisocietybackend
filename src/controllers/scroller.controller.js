const { v4: uuidv4 } = require('uuid');
const { pool, isPostgresEnabled, withTenant } = require('../config/postgres');
const { isPlatformRole } = require('../constants/roles');
const { logAudit } = require('./audit.controller');

const URGENCY_LEVELS = { NORMAL: 'NORMAL', IMPORTANT: 'IMPORTANT', URGENT: 'URGENT' };
const SCROLL_SPEEDS = { SLOW: 'SLOW', MEDIUM: 'MEDIUM', FAST: 'FAST' };
const MAX_CHARS = 280;

// ─── Platform Admin: Create Platform Scroller ──────────────────────────
exports.createPlatformScroller = async (req, res) => {
  try {
    if (!isPlatformRole(req.user.role)) {
      return res.status(403).json({ error: 'Platform admin access required' });
    }

    const { message, urgency_level, start_at, end_at, target_audience, scroll_speed } = req.body;

    if (!message || message.length > MAX_CHARS) {
      return res.status(400).json({ error: `Message must be 1-${MAX_CHARS} characters` });
    }

    const sanitized = message.replace(/<[^>]*>/g, '').substring(0, MAX_CHARS);
    const speed = SCROLL_SPEEDS[scroll_speed] || SCROLL_SPEEDS.MEDIUM;
    const id = uuidv4();
    const now = new Date().toISOString();

    await pool.query(`
      INSERT INTO platform.scrollers
        (id, level, message, urgency_level, start_at, end_at, target_audience, scroll_speed, created_by, impressions, is_active, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
    `, [id, 'PLATFORM', sanitized, urgency_level || URGENCY_LEVELS.NORMAL,
        start_at || now, end_at || null, target_audience || 'ALL', speed,
        req.user.id, 0, 1, now]);

    await logAudit(req, 'SCROLLER_CREATED', 'SCROLLER', id, null, { level: 'PLATFORM', message: sanitized, urgency_level: urgency_level || URGENCY_LEVELS.NORMAL });
    res.status(201).json({ message: 'Platform scroller created', id, urgency_level });
  } catch (error) {
    console.error('Create platform scroller error:', error);
    res.status(500).json({ error: 'Failed to create scroller' });
  }
};

// ─── Society Admin: Create Society Scroller ────────────────────────────
exports.createSocietyScroller = async (req, res) => {
  try {
    if (!['ADMIN', 'TREASURER', 'COMMITTEE'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Society admin access required' });
    }

    const { message, urgency_level, start_at, end_at, target_audience, target_wing, scroll_speed } = req.body;

    if (!message || message.length > MAX_CHARS) {
      return res.status(400).json({ error: `Message must be 1-${MAX_CHARS} characters` });
    }

    const sanitized = message.replace(/<[^>]*>/g, '').substring(0, MAX_CHARS);
    const speed = SCROLL_SPEEDS[scroll_speed] || SCROLL_SPEEDS.MEDIUM;
    const id = uuidv4();
    const now = new Date().toISOString();

    await withTenant(req.user.society_id, async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS scrollers (
          id TEXT PRIMARY KEY, level TEXT DEFAULT 'SOCIETY',
          message TEXT, urgency_level TEXT DEFAULT 'NORMAL',
          start_at TIMESTAMPTZ, end_at TIMESTAMPTZ,
          target_audience TEXT DEFAULT 'ALL', target_wing TEXT,
          scroll_speed TEXT DEFAULT 'MEDIUM',
          created_by TEXT, impressions INTEGER DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        INSERT INTO scrollers (id, level, message, urgency_level, start_at, end_at, target_audience, target_wing, scroll_speed, created_by, impressions, is_active, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
      `, [id, 'SOCIETY', sanitized, urgency_level || URGENCY_LEVELS.NORMAL,
          start_at || now, end_at || null, target_audience || 'ALL', target_wing || null, speed,
          req.user.id, 0, 1, now]);
    });

    await logAudit(req, 'SCROLLER_CREATED', 'SCROLLER', id, null, { level: 'SOCIETY', message: sanitized });
    res.status(201).json({ message: 'Society scroller created', id });
  } catch (error) {
    console.error('Create society scroller error:', error);
    res.status(500).json({ error: 'Failed to create scroller' });
  }
};

// ─── Get Active Scrollers ──────────────────────────────────────────────
exports.getActiveScrollers = async (req, res) => {
  try {
    const scrollers = [];
    const viewerRole = String(req.user.role || '').toUpperCase();
    // PLATFORM_ADMIN is not in the audience dropdown; match ADMIN-targeted scrollers too
    const audienceRole = viewerRole === 'PLATFORM_ADMIN' ? 'ADMIN' : viewerRole;

    const includeAll =
      req.query.include_all === '1' ||
      req.query.include_all === 'true' ||
      req.query.manage === '1';

    // Platform admins: list every platform row (scheduled / paused) for the management UI
    if (includeAll && isPlatformRole(req.user.role) && isPostgresEnabled && pool) {
      const allPlatform = await pool.query(`
        SELECT id, 'PLATFORM' as level, message, urgency_level, start_at, end_at, target_audience, is_active, created_at
        FROM platform.scrollers
        ORDER BY created_at DESC
      `);
      for (const s of allPlatform.rows) {
        scrollers.push(s);
      }
    } else if (isPostgresEnabled && pool) {
      // Live only: use DB clock so filters match server timezone; avoid "scheduled for later today" confusion vs JS ISO
      const platformScrollers = await pool.query(
        `
        SELECT id, 'PLATFORM' as level, message, urgency_level, start_at, end_at, target_audience, is_active
        FROM platform.scrollers
        WHERE COALESCE(is_active, 1) = 1
          AND (start_at IS NULL OR start_at <= NOW())
          AND (end_at IS NULL OR end_at >= NOW())
          AND (target_audience = 'ALL' OR target_audience = $1)
        ORDER BY urgency_level = 'URGENT' DESC, urgency_level = 'IMPORTANT' DESC, created_at DESC
      `,
        [audienceRole]
      );

      for (const s of platformScrollers.rows) {
        scrollers.push(s);
      }
    }

    if (req.user.society_id) {
      await withTenant(req.user.society_id, async (client) => {
        const societyScrollers = await client.query(
          `
          SELECT id, 'SOCIETY' as level, message, urgency_level, start_at, end_at, target_audience, target_wing, is_active
          FROM scrollers
          WHERE COALESCE(is_active, 1) = 1
            AND (start_at IS NULL OR start_at <= NOW())
            AND (end_at IS NULL OR end_at >= NOW())
            AND (target_audience = 'ALL' OR target_audience = $1)
            AND (target_wing IS NULL OR target_wing = $2)
          ORDER BY urgency_level = 'URGENT' DESC, urgency_level = 'IMPORTANT' DESC, created_at DESC
        `,
          [audienceRole, req.user.wing || null]
        );

        for (const s of societyScrollers.rows) {
          scrollers.push(s);
        }
      });
    }

    res.json({ scrollers });
  } catch (error) {
    console.error('Get scrollers error:', error);
    res.status(500).json({ error: 'Failed to fetch scrollers' });
  }
};

// ─── Update Scroller ───────────────────────────────────────────────────
exports.updateScroller = async (req, res) => {
  try {
    const { id, message, urgency_level, start_at, end_at, is_active, target_audience } = req.body;
    const { level, scroller_id } = req.params;

    const sanitized = message ? message.replace(/<[^>]*>/g, '').substring(0, MAX_CHARS) : null;
    const normalizedLevel = String(level || '').toUpperCase();

    if (normalizedLevel === 'PLATFORM') {
      if (!isPlatformRole(req.user.role)) return res.status(403).json({ error: 'Platform admin required' });
      await pool.query(`
        UPDATE platform.scrollers SET
          message = COALESCE($1, message),
          urgency_level = COALESCE($2, urgency_level),
          start_at = COALESCE($3, start_at),
          end_at = COALESCE($4, end_at),
          is_active = COALESCE($5, is_active),
          target_audience = COALESCE($6, target_audience),
          updated_at = NOW()
        WHERE id = $7
      `, [sanitized, urgency_level, start_at, end_at, is_active, target_audience, scroller_id]);
    } else if (normalizedLevel === 'SOCIETY') {
      if (!['ADMIN', 'TREASURER', 'COMMITTEE'].includes(req.user.role)) return res.status(403).json({ error: 'Society admin required' });
      await withTenant(req.user.society_id, async (client) => {
        await client.query(`
          UPDATE scrollers SET
            message = COALESCE($1, message),
            urgency_level = COALESCE($2, urgency_level),
            start_at = COALESCE($3, start_at),
            end_at = COALESCE($4, end_at),
            is_active = COALESCE($5, is_active),
            target_audience = COALESCE($6, target_audience),
            updated_at = NOW()
          WHERE id = $7
        `, [sanitized, urgency_level, start_at, end_at, is_active, target_audience, scroller_id]);
      });
    } else {
      return res.status(400).json({ error: 'Invalid level. Must be PLATFORM or SOCIETY' });
    }

    await logAudit(req, 'SCROLLER_UPDATED', 'SCROLLER', scroller_id, null, { level: normalizedLevel, is_active });
    res.json({ message: 'Scroller updated' });
  } catch (error) {
    console.error('Update scroller error:', error);
    res.status(500).json({ error: 'Failed to update scroller' });
  }
};

// ─── Delete Scroller ───────────────────────────────────────────────────
exports.deleteScroller = async (req, res) => {
  try {
    const { level, scroller_id } = req.params;
    const normalizedLevel = String(level || '').toUpperCase();

    if (normalizedLevel === 'PLATFORM') {
      if (!isPlatformRole(req.user.role)) return res.status(403).json({ error: 'Platform admin required' });
      await pool.query('DELETE FROM platform.scrollers WHERE id = $1', [scroller_id]);
    } else if (normalizedLevel === 'SOCIETY') {
      if (!['ADMIN', 'TREASURER', 'COMMITTEE'].includes(req.user.role)) return res.status(403).json({ error: 'Society admin required' });
      await withTenant(req.user.society_id, async (client) => {
        await client.query('DELETE FROM scrollers WHERE id = $1', [scroller_id]);
      });
    } else {
      return res.status(400).json({ error: 'Invalid level' });
    }

    await logAudit(req, 'SCROLLER_DELETED', 'SCROLLER', scroller_id, { level: normalizedLevel }, null);
    res.json({ message: 'Scroller deleted' });
  } catch (error) {
    console.error('Delete scroller error:', error);
    res.status(500).json({ error: 'Failed to delete scroller' });
  }
};

// ─── Track Impression ───────────────────────────────────────────────────
exports.trackImpression = async (req, res) => {
  try {
    const { scroller_id } = req.body;
    const { level } = req.params;
    const normalizedLevel = String(level || '').toUpperCase();

    if (normalizedLevel === 'PLATFORM') {
      await pool.query('UPDATE platform.scrollers SET impressions = impressions + 1 WHERE id = $1', [scroller_id]);
    } else if (normalizedLevel === 'SOCIETY') {
      await withTenant(req.user.society_id, async (client) => {
        await client.query('UPDATE scrollers SET impressions = impressions + 1 WHERE id = $1', [scroller_id]);
      });
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to track impression' });
  }
};

exports.URGENCY_LEVELS = URGENCY_LEVELS;
exports.SCROLL_SPEEDS = SCROLL_SPEEDS;
exports.MAX_CHARS = MAX_CHARS;