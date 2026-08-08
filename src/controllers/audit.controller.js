const { v4: uuidv4 } = require('uuid');
const { withTenant, isPostgresEnabled, pool } = require('../config/postgres');
const { getDb } = require('../config/database');

// ─── Table bootstrap ──────────────────────────────────────────────────────────
const ensureAuditTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id           TEXT PRIMARY KEY,
      tenant_id    TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      action       TEXT NOT NULL,
      entity_type  TEXT,
      entity_id    TEXT,
      before_state JSONB,
      after_state  JSONB,
      ip_address   TEXT,
      user_agent   TEXT,
      trace_id     TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs (entity_type, entity_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs (user_id)`);
};

// ─── Internal helper (called from other controllers) ─────────────────────────
const logAudit = async (req, action, entityType, entityId, beforeState, afterState, client = null) => {
  try {
    const tenantId = req?.user?.society_id || 'platform';
    const userId   = req?.user?.id || 'system';
    const ip       = (req?.ip || '').replace(/::ffff:/, '');
    const ua       = req?.headers?.['user-agent'] || '';
    const traceId  = uuidv4();
    const id       = uuidv4();

    const entry = {
      id, tenant_id: tenantId, user_id: userId, action,
      entity_type: entityType, entity_id: entityId,
      before_state: beforeState ? JSON.stringify(beforeState) : null,
      after_state:  afterState  ? JSON.stringify(afterState)  : null,
      ip_address: ip, user_agent: ua, trace_id: traceId
    };

    if (isPostgresEnabled && tenantId !== 'platform') {
      const executeInsert = async (dbClient) => {
        await ensureAuditTable(dbClient);
        await dbClient.query(
          `INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,before_state,after_state,ip_address,user_agent,trace_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [id, tenantId, userId, action, entityType || null, entityId || null,
           entry.before_state, entry.after_state, ip, ua, traceId]
        );
      };

      if (client) {
        await executeInsert(client);
      } else {
        await withTenant(tenantId, executeInsert);
      }
    } else {
      // LowDB fallback
      try {
        const db = getDb();
        const logs = db.get('audit_logs').value() || [];
        if (!logs) db.set('audit_logs', []).write();
        db.get('audit_logs').push({ ...entry, created_at: new Date().toISOString() }).write();
      } catch (_) { /* best-effort */ }
    }
  } catch (err) {
    console.error('[Audit] Failed to log:', err.message);
  }
};

module.exports.logAudit = logAudit;

// ─── HTTP Controllers ─────────────────────────────────────────────────────────

// GET /api/audit  — role-gated: ADMIN, TREASURER, PLATFORM_ADMIN, AUDITOR
module.exports.getLogs = async (req, res) => {
  try {
    const { entity_type, action, user_id, from, to, limit = 100, offset = 0 } = req.query;

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureAuditTable(client);

        let q = `SELECT al.*, pu.first_name || ' ' || pu.last_name AS actor_name, pu.email AS actor_email
                 FROM audit_logs al
                 LEFT JOIN platform.users pu ON pu.id = al.user_id
                 WHERE al.tenant_id = $1`;
        const params = [req.user.society_id];
        let idx = 2;

        if (entity_type) { q += ` AND al.entity_type = $${idx++}`; params.push(entity_type); }
        if (action)      { q += ` AND al.action = $${idx++}`;       params.push(action); }
        if (user_id)     { q += ` AND al.user_id = $${idx++}`;      params.push(user_id); }
        if (from)        { q += ` AND al.created_at >= $${idx++}`;  params.push(`${from} 00:00:00`); }
        if (to)          { q += ` AND al.created_at <= $${idx++}`;  params.push(`${to} 23:59:59`); }

        q += ` ORDER BY al.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(parseInt(limit), parseInt(offset));

        const { rows } = await client.query(q, params);
        const { rows: countRows } = await client.query(
          `SELECT COUNT(*) AS total FROM audit_logs WHERE tenant_id = $1`,
          [req.user.society_id]
        );
        return res.json({ logs: rows, total: parseInt(countRows[0].total) });
      }).catch((e) => res.status(500).json({ error: e.message || 'Failed to fetch audit logs' }));
    }

    // LowDB fallback
    const db = getDb();
    let logs = db.get('audit_logs').filter({ tenant_id: req.user.society_id || 'platform' }).value() || [];
    logs = logs.reverse().slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    res.json({ logs, total: logs.length });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to fetch audit logs' });
  }
};

// GET /api/audit/actions  — distinct action list for filter UI
module.exports.getActionTypes = async (req, res) => {
  const KNOWN_ACTIONS = [
    'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT',
    'VOUCHER_CREATED', 'VOUCHER_APPROVED', 'VOUCHER_REVERSED',
    'ACCOUNT_CREATED', 'BILL_GENERATED', 'PAYMENT_RECEIVED',
    'MEMBER_CREATED', 'MEMBER_UPDATED', 'MEMBER_DEACTIVATED',
    'COMPLAINT_RAISED', 'COMPLAINT_RESOLVED', 'NOTICE_PUBLISHED',
    'VISITOR_CHECKED_IN', 'VISITOR_CHECKED_OUT',
    'CONSENT_UPDATED', 'DATA_ERASURE_REQUEST',
    'PERMISSION_DENIED', 'ROLE_CHANGED',
  ];
  res.json({ actions: KNOWN_ACTIONS });
};

// GET /api/audit/stats  — summary for dashboard widget
module.exports.getAuditStats = async (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureAuditTable(client);
        const { rows } = await client.query(`
          SELECT
            COUNT(*) AS total,
            COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) AS last_24h,
            COUNT(CASE WHEN action LIKE 'VOUCHER%' THEN 1 END) AS financial_events,
            COUNT(CASE WHEN action IN ('LOGIN_SUCCESS','LOGIN_FAILURE','LOGOUT') THEN 1 END) AS auth_events,
            COUNT(CASE WHEN action = 'PERMISSION_DENIED' THEN 1 END) AS security_events
          FROM audit_logs WHERE tenant_id = $1
        `, [req.user.society_id]);
        return res.json({ stats: rows[0] });
      }).catch(() => res.json({ stats: { total: 0, last_24h: 0, financial_events: 0, auth_events: 0, security_events: 0 } }));
    }
    res.json({ stats: { total: 0, last_24h: 0, financial_events: 0, auth_events: 0, security_events: 0 } });
  } catch {
    res.status(500).json({ error: 'Failed to get stats' });
  }
};
