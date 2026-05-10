const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool, isPostgresEnabled, ensurePlatformSchema, createTenantSchema, getTenantSchemaName } = require('../config/postgres');
const { isPlatformRole } = require('../constants/roles');
const { ensurePlanTable } = require('./plan.controller');
const { logAudit } = require('./audit.controller');
const { sendVerificationEmail, sendWelcomeEmail, sendKYCRejectionEmail, sendReUploadRequestEmail } = require('../utils/email');

const SUBSCRIPTION_PLANS = {
  CORE: { name: 'Core', pricePerUnit: 30, features: ['accounting', 'billing', 'tally_export'] },
  COMPLIANCE: { name: 'Compliance', pricePerUnit: 50, features: ['accounting', 'billing', 'gst', 'tds', 'tally_export', 'property_listings'] },
  AI_PRO: { name: 'AI Pro', pricePerUnit: 80, features: ['accounting', 'billing', 'gst', 'tds', 'ai', 'chatbot', 'tally_export', 'property_listings'] }
};

/** Merges built-in defaults with rows from platform.plans (DB wins on same code). */
async function getSubscriptionPlansCatalog() {
  const merged = {};
  for (const [code, def] of Object.entries(SUBSCRIPTION_PLANS)) {
    merged[code] = { name: def.name, pricePerUnit: def.pricePerUnit, features: [...def.features] };
  }
  if (!isPostgresEnabled || !pool) return merged;
  try {
    await ensurePlanTable();
    const r = await pool.query('SELECT code, name, price, features FROM platform.plans ORDER BY created_at ASC');
    for (const row of r.rows) {
      if (!row.code) continue;
      const code = String(row.code).trim().toUpperCase();
      let features = row.features;
      if (features == null) features = [];
      else if (typeof features === 'string') {
        try {
          features = JSON.parse(features);
        } catch {
          features = [];
        }
      }
      if (!Array.isArray(features)) features = [];
      merged[code] = {
        name: row.name || code,
        pricePerUnit: Number(row.price) || 0,
        features
      };
    }
  } catch (e) {
    console.error('getSubscriptionPlansCatalog', e);
  }
  return merged;
}

const ONBOARDING_STATES = {
  REGISTRATION_FORM: 'REGISTRATION_FORM',
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  KYC_PENDING: 'KYC_PENDING',
  DOCUMENT_UPLOAD: 'DOCUMENT_UPLOAD',
  KYC_UNDER_REVIEW: 'KYC_UNDER_REVIEW',
  KYC_APPROVED: 'KYC_APPROVED',
  KYC_REJECTED: 'KYC_REJECTED',
  SCHEMA_PROVISIONED: 'SCHEMA_PROVISIONED',
  CONFIGURATION_WIZARD: 'CONFIGURATION_WIZARD',
  TRIAL_ACTIVE: 'TRIAL_ACTIVE',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  REACTIVATED: 'REACTIVATED',
  OFFBOARDED: 'OFFBOARDED'
};

/** Shared manual renewal (platform admin). Used by POST /subscription/renew and action RENEW. */
async function manualRenewalCore(poolConn, society, society_id, { renewal_date, extend_months, reason, userId }) {
  let newDateStr;
  if (renewal_date != null && String(renewal_date).trim() !== '') {
    const raw = String(renewal_date)
      .normalize('NFKC')
      .trim()
      .split('T')[0]
      .replace(/\u2212/g, '-');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const e = new Error('renewal_date must be YYYY-MM-DD');
      e.statusCode = 400;
      throw e;
    }
    newDateStr = raw;
  } else {
    let months = parseInt(extend_months, 10);
    if (!Number.isFinite(months) || months < 1) months = 12;
    if (months > 120) months = 120;
    const todayStr = new Date().toISOString().split('T')[0];
    const [ty, tm, td] = todayStr.split('-').map(Number);
    const todayUtc = new Date(Date.UTC(ty, tm - 1, td));
    let by; let bm; let bd;
    if (society.renewal_date) {
      const rd = String(society.renewal_date).split('T')[0];
      [by, bm, bd] = rd.split('-').map(Number);
    } else {
      by = ty;
      bm = tm;
      bd = td;
    }
    let baseUtc = new Date(Date.UTC(by, bm - 1, bd));
    if (baseUtc.getTime() < todayUtc.getTime()) {
      baseUtc = todayUtc;
    }
    const next = new Date(Date.UTC(baseUtc.getUTCFullYear(), baseUtc.getUTCMonth() + months, baseUtc.getUTCDate()));
    newDateStr = next.toISOString().split('T')[0];
  }

  let newStatus = society.subscription_status;
  let newOnboarding = society.onboarding_state;
  if (newStatus === 'OFFBOARDED') {
    newStatus = 'ACTIVE';
    newOnboarding = ONBOARDING_STATES.REACTIVATED;
  }

  const now = new Date().toISOString();
  await poolConn.query(
    `
    UPDATE platform.societies SET
      renewal_date = $1::date,
      subscription_status = $2,
      onboarding_state = $3,
      subscription_action = $4,
      subscription_action_reason = $5,
      subscription_action_by = $6,
      subscription_action_at = $7::timestamptz,
      updated_at = $7::timestamptz
    WHERE id = $8
  `,
    [newDateStr, newStatus, newOnboarding, 'RENEW', reason || null, userId, now, society_id]
  );

  return {
    message: 'Renewal recorded',
    renewal_date: newDateStr,
    subscription_status: newStatus
  };
}

// ─── Platform Admin: Get All Societies ─────────────────────────────────
exports.getAllSocieties = async (req, res) => {
  try {
    if (!isPlatformRole(req.user.role)) {
      return res.status(403).json({ error: 'Platform admin access required' });
    }

    const { status, plan, search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = [];
    let params = [];
    let idx = 1;

    if (status) { where.push(`s.subscription_status = $${idx++}`); params.push(status); }
    if (plan) { where.push(`s.subscription_plan = $${idx++}`); params.push(plan); }
    if (search) {
      where.push(`(s.name ILIKE $${idx} OR s.registration_number ILIKE $${idx} OR s.city ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) FROM platform.societies s ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    params.push(parseInt(limit), offset);
    const result = await pool.query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM platform.users u WHERE u.society_id = s.id) as member_count,
        (SELECT COUNT(*) FROM platform.flats f WHERE f.society_id = s.id) as flat_count
      FROM platform.societies s
      ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT $${idx++} OFFSET $${idx}
    `, params);

    res.json({ societies: result.rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error('Get societies error:', error);
    res.status(500).json({ error: 'Failed to fetch societies' });
  }
};

// ─── Platform Admin: Get Society Details ────────────────────────────────
exports.getSocietyById = async (req, res) => {
  try {
    if (!isPlatformRole(req.user.role)) {
      return res.status(403).json({ error: 'Platform admin access required' });
    }

    const result = await pool.query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM platform.users u WHERE u.society_id = s.id) as member_count,
        (SELECT COUNT(*) FROM platform.flats f WHERE f.society_id = s.id) as flat_count
      FROM platform.societies s WHERE s.id = $1
    `, [req.params.id]);

    if (!result.rows.length) return res.status(404).json({ error: 'Society not found' });
    res.json({ society: result.rows[0] });
  } catch (error) {
    console.error('Get society error:', error);
    res.status(500).json({ error: 'Failed to fetch society' });
  }
};

// ─── Society Self-Registration ─────────────────────────────────────────
exports.registerSociety = async (req, res) => {
  try {
    const { name, registration_number, address, city, state, pincode, gst_status, total_units, total_wings, contact_name, contact_email, contact_phone, plan } = req.body;

    if (!name || !contact_email || !contact_phone || !plan) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const catalog = await getSubscriptionPlansCatalog();
    const planKey = String(plan).trim().toUpperCase();
    if (!catalog[planKey]) {
      return res.status(400).json({ error: 'Invalid subscription plan' });
    }

    const now = new Date().toISOString();
    const societyId = uuidv4();
    const onboarding_id = uuidv4();
    const verification_token = uuidv4();

    await pool.query(`
      INSERT INTO platform.societies
        (id, name, registration_number, address, city, state, pincode, total_units, total_wings,
         status, subscription_plan, subscription_status, onboarding_state, verification_token,
         gst_status, contact_name, contact_email, contact_phone, active_modules,
         created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
    `, [
      societyId, name, registration_number || null, address || null, city, state, pincode || null,
      total_units || 0, total_wings || 0,
      'PENDING', planKey, 'REGISTRATION_FORM', ONBOARDING_STATES.REGISTRATION_FORM, verification_token,
      gst_status || null, contact_name || null, contact_email, contact_phone,
      JSON.stringify(catalog[planKey]?.features || []),
      now, now
    ]);

    sendVerificationEmail(contact_email, verification_token).catch(e => console.error('Verification email failed:', e.message));
    await logAudit(req, 'SOCIETY_REGISTERED', 'SOCIETY', societyId, null, { name, onboarding_state: ONBOARDING_STATES.REGISTRATION_FORM });

    res.status(201).json({
      message: 'Registration submitted. Please check your email to verify.',
      society_id: societyId,
      onboarding_state: ONBOARDING_STATES.REGISTRATION_FORM
    });
  } catch (error) {
    console.error('Register society error:', error);
    res.status(500).json({ error: 'Failed to register society' });
  }
};

// ─── Verify Society Email ───────────────────────────────────────────────
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    const result = await pool.query(
      'SELECT * FROM platform.societies WHERE verification_token = $1',
      [token]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Invalid verification token' });

    const society = result.rows[0];
    if (society.onboarding_state !== ONBOARDING_STATES.REGISTRATION_FORM && society.onboarding_state !== ONBOARDING_STATES.EMAIL_VERIFICATION) {
      return res.status(400).json({ error: 'Society already verified or onboarding progressed' });
    }

    await pool.query(
      'UPDATE platform.societies SET onboarding_state = $1, verification_token = NULL, updated_at = NOW() WHERE id = $2',
      [ONBOARDING_STATES.KYC_PENDING, society.id]
    );

    res.json({ message: 'Email verified successfully. KYC submission pending.', next_step: 'DOCUMENT_UPLOAD' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Failed to verify email' });
  }
};

// ─── Society: Submit KYC Documents ─────────────────────────────────────
exports.submitKYC = async (req, res) => {
  try {
    const { society_id } = req.body;
    const { reg_certificate, bye_laws, committee_resolution, bank_details, pan_cert, gst_cert } = req.body.documents || {};

    const result = await pool.query(
      'SELECT * FROM platform.societies WHERE id = $1',
      [society_id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Society not found' });
    const society = result.rows[0];

    if (![ONBOARDING_STATES.KYC_PENDING, ONBOARDING_STATES.KYC_UNDER_REVIEW].includes(society.onboarding_state)) {
      return res.status(400).json({ error: 'KYC not allowed in current state' });
    }

    await pool.query(`
      UPDATE platform.societies SET
        onboarding_state = $1,
        kyc_documents = $2,
        gst_number = $3,
        pan_number = $4,
        bank_name = $5,
        bank_account_number = $6,
        bank_ifsc = $7,
        updated_at = NOW()
      WHERE id = $8
    `, [
      ONBOARDING_STATES.DOCUMENT_UPLOAD,
      JSON.stringify({ reg_certificate, bye_laws, committee_resolution, pan_cert, gst_cert }),
      req.body.gst_number || null, req.body.pan_number || null,
      req.body.bank_name || null, req.body.bank_account_number || null, req.body.bank_ifsc || null,
      society_id
    ]);

    // Move to KYC_UNDER_REVIEW automatically for admin review
    await pool.query('UPDATE platform.societies SET onboarding_state = $1 WHERE id = $2', [ONBOARDING_STATES.KYC_UNDER_REVIEW, society_id]);

    res.json({ message: 'Documents submitted. Awaiting Platform Admin review.', state: ONBOARDING_STATES.KYC_UNDER_REVIEW });
  } catch (error) {
    console.error('Submit KYC error:', error);
    res.status(500).json({ error: 'Failed to submit KYC' });
  }
};

// ─── Platform Admin: Get KYC Queue ───────────────────────────────────────
exports.getKYCPending = async (req, res) => {
  try {
    if (!isPlatformRole(req.user.role)) {
      return res.status(403).json({ error: 'Platform admin access required' });
    }

    const { state, page = 1, limit = 20 } = req.query;
    const states = state ? [state] : [ONBOARDING_STATES.KYC_PENDING, ONBOARDING_STATES.DOCUMENT_UPLOAD, ONBOARDING_STATES.KYC_UNDER_REVIEW];
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await pool.query(`
      SELECT id, name, registration_number, city, state, subscription_plan, onboarding_state,
             contact_name, contact_email, contact_phone, total_units, created_at, updated_at
      FROM platform.societies
      WHERE onboarding_state = ANY($1)
      ORDER BY updated_at ASC
      LIMIT $2 OFFSET $3
    `, [states, parseInt(limit), offset]);

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM platform.societies WHERE onboarding_state = ANY($1)',
      [states]
    );

    res.json({ societies: result.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page) });
  } catch (error) {
    console.error('Get KYC queue error:', error);
    res.status(500).json({ error: 'Failed to fetch KYC queue' });
  }
};

// ─── Platform Admin: Approve KYC ─────────────────────────────────────────
exports.approveKYC = async (req, res) => {
  try {
    if (!isPlatformRole(req.user.role)) {
      return res.status(403).json({ error: 'Platform admin access required' });
    }

    const { society_id, comment } = req.body;
    const result = await pool.query('SELECT * FROM platform.societies WHERE id = $1', [society_id]);

    if (!result.rows.length) return res.status(404).json({ error: 'Society not found' });
    const society = result.rows[0];

    if (![ONBOARDING_STATES.KYC_UNDER_REVIEW].includes(society.onboarding_state)) {
      return res.status(400).json({ error: 'KYC approval not allowed in current state' });
    }

    // Provision PostgreSQL schema
    const schemaName = await createTenantSchema(society_id);

    // Update society state
    await pool.query(`
      UPDATE platform.societies SET
        onboarding_state = $1,
        status = $2,
        kyc_approved_by = $3,
        kyc_approval_comment = $4,
        kyc_approved_at = NOW(),
        updated_at = NOW()
      WHERE id = $5
    `, [ONBOARDING_STATES.SCHEMA_PROVISIONED, 'TRIAL', req.user.id, comment || null, society_id]);

    const soc = (await pool.query('SELECT contact_email, name FROM platform.societies WHERE id = $1', [society_id])).rows[0];
    if (soc?.contact_email) sendWelcomeEmail(soc.contact_email, soc.name, schemaName).catch(e => console.error('Welcome email failed:', e.message));
    await logAudit(req, 'KYC_APPROVED', 'SOCIETY', society_id, null, { approved_by: req.user.id });

    res.json({ message: 'KYC approved. Schema provisioned.', schema: schemaName, state: ONBOARDING_STATES.SCHEMA_PROVISIONED });
  } catch (error) {
    console.error('Approve KYC error:', error);
    res.status(500).json({ error: 'Failed to approve KYC' });
  }
};

// ─── Platform Admin: Reject KYC ─────────────────────────────────────────
exports.rejectKYC = async (req, res) => {
  try {
    if (!isPlatformRole(req.user.role)) {
      return res.status(403).json({ error: 'Platform admin access required' });
    }

    const { society_id, reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Rejection reason is mandatory' });

    const result = await pool.query('SELECT * FROM platform.societies WHERE id = $1', [society_id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Society not found' });

    const rejection_days = 7; // Re-application locked for 7 days
    const unlock_date = new Date(Date.now() + rejection_days * 86400000).toISOString();

    await pool.query(`
      UPDATE platform.societies SET
        onboarding_state = $1,
        status = 'REJECTED',
        kyc_rejected_by = $2,
        kyc_rejection_reason = $3,
        kyc_rejected_at = NOW(),
        reapplication_unlocked_at = $4,
        updated_at = NOW()
      WHERE id = $5
    `, [ONBOARDING_STATES.KYC_REJECTED, req.user.id, reason, unlock_date, society_id]);

    const soc = (await pool.query('SELECT contact_email, name FROM platform.societies WHERE id = $1', [society_id])).rows[0];
    if (soc?.contact_email) sendKYCRejectionEmail(soc.contact_email, soc.name, reason, unlock_date).catch(e => console.error('Rejection email failed:', e.message));
    await logAudit(req, 'KYC_REJECTED', 'SOCIETY', society_id, null, { reason });

    res.json({ message: 'KYC rejected.', unlock_date, state: ONBOARDING_STATES.KYC_REJECTED });
  } catch (error) {
    console.error('Reject KYC error:', error);
    res.status(500).json({ error: 'Failed to reject KYC' });
  }
};

// ─── Platform Admin: Subscription Control ───────────────────────────────
exports.updateSubscription = async (req, res) => {
  try {
    if (!isPlatformRole(req.user.role)) {
      return res.status(403).json({ error: 'Platform admin access required' });
    }

    const { society_id, action, reason, plan, renewal_date, extend_months } = req.body;
    const result = await pool.query('SELECT * FROM platform.societies WHERE id = $1', [society_id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Society not found' });

    const society = result.rows[0];
    const now = new Date().toISOString();

    let newStatus = society.subscription_status;
    let newOnboardingState = society.onboarding_state;

    let normalizedAction = String(action ?? '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
    if (normalizedAction === 'RENEWAL') normalizedAction = 'RENEW';

    switch (normalizedAction) {
      case 'ACTIVATE':
        newStatus = 'ACTIVE';
        newOnboardingState = ONBOARDING_STATES.ACTIVE;
        break;
      case 'SUSPEND':
        newStatus = 'SUSPENDED';
        newOnboardingState = ONBOARDING_STATES.SUSPENDED;
        break;
      case 'REACTIVATE':
        newStatus = 'ACTIVE';
        newOnboardingState = ONBOARDING_STATES.REACTIVATED;
        break;
      case 'DISCONTINUE':
        newStatus = 'OFFBOARDED';
        newOnboardingState = ONBOARDING_STATES.OFFBOARDED;
        break;
      case 'CHANGE_PLAN': {
        const catalog = await getSubscriptionPlansCatalog();
        const planKey = plan ? String(plan).trim().toUpperCase() : '';
        if (planKey && catalog[planKey]) {
          await pool.query(
            'UPDATE platform.societies SET subscription_plan = $1, active_modules = $2, updated_at = NOW() WHERE id = $3',
            [planKey, JSON.stringify(catalog[planKey].features), society_id]
          );
          return res.json({ message: 'Plan changed successfully', plan: planKey, features: catalog[planKey].features });
        }
        return res.status(400).json({ error: 'Invalid plan' });
      }
      case 'RENEW': {
        try {
          const out = await manualRenewalCore(pool, society, society_id, {
            renewal_date,
            extend_months,
            reason,
            userId: req.user.id
          });
          return res.json(out);
        } catch (err) {
          if (err.statusCode === 400) return res.status(400).json({ error: err.message });
          throw err;
        }
      }
      default:
        return res.status(400).json({
          error: 'Invalid action',
          allowed: ['ACTIVATE', 'SUSPEND', 'REACTIVATE', 'DISCONTINUE', 'CHANGE_PLAN', 'RENEW']
        });
    }

    await pool.query(`
      UPDATE platform.societies SET
        subscription_status = $1,
        onboarding_state = $2,
        subscription_action = $3,
        subscription_action_reason = $4,
        subscription_action_by = $5,
        subscription_action_at = $6,
        updated_at = $6
      WHERE id = $7
    `, [newStatus, newOnboardingState, normalizedAction, reason || null, req.user.id, now, society_id]);

    res.json({
      message: `Subscription ${normalizedAction.toLowerCase()} successful`,
      status: newStatus,
      state: newOnboardingState
    });
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
};

// ─── Platform Admin: Manual renewal (dedicated route — no reliance on body.action) ───
exports.recordManualRenewal = async (req, res) => {
  try {
    if (!isPlatformRole(req.user.role)) {
      return res.status(403).json({ error: 'Platform admin access required' });
    }
    const { society_id, renewal_date, extend_months, reason } = req.body;
    if (!society_id) {
      return res.status(400).json({ error: 'society_id is required' });
    }
    const result = await pool.query('SELECT * FROM platform.societies WHERE id = $1', [society_id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Society not found' });
    const society = result.rows[0];
    try {
      const out = await manualRenewalCore(pool, society, society_id, {
        renewal_date,
        extend_months,
        reason,
        userId: req.user.id
      });
      return res.json(out);
    } catch (err) {
      if (err.statusCode === 400) return res.status(400).json({ error: err.message });
      throw err;
    }
  } catch (error) {
    console.error('recordManualRenewal error:', error);
    res.status(500).json({ error: 'Failed to record renewal' });
  }
};

// ─── Platform Admin: Feature Flags ──────────────────────────────────────
exports.updateFeatureFlags = async (req, res) => {
  try {
    if (!isPlatformRole(req.user.role)) {
      return res.status(403).json({ error: 'Platform admin access required' });
    }

    const { society_id, features } = req.body;
    await pool.query(
      'UPDATE platform.societies SET active_modules = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(features), society_id]
    );

    res.json({ message: 'Feature flags updated', features });
  } catch (error) {
    console.error('Update feature flags error:', error);
    res.status(500).json({ error: 'Failed to update feature flags' });
  }
};

// ─── Platform Admin: Dashboard Stats ────────────────────────────────────
exports.getPlatformStats = async (req, res) => {
  try {
    if (!isPlatformRole(req.user.role)) {
      return res.status(403).json({ error: 'Platform admin access required' });
    }

    const [totalResult, statusResult, planResult, recentResult] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM platform.societies'),
      pool.query('SELECT subscription_status, COUNT(*) FROM platform.societies GROUP BY subscription_status'),
      pool.query('SELECT subscription_plan, COUNT(*) FROM platform.societies WHERE subscription_status != $1 GROUP BY subscription_plan', ['OFFBOARDED']),
      pool.query('SELECT id, name, subscription_status, onboarding_state, created_at FROM platform.societies ORDER BY created_at DESC LIMIT 10')
    ]);

    const stats = {
      total_societies: parseInt(totalResult.rows[0].count),
      by_status: {},
      by_plan: {},
      recent: recentResult.rows
    };

    for (const row of statusResult.rows) {
      stats.by_status[row.subscription_status] = parseInt(row.count);
    }
    for (const row of planResult.rows) {
      stats.by_plan[row.subscription_plan] = parseInt(row.count);
    }

    res.json({ stats });
  } catch (error) {
    console.error('Platform stats error:', error);
    res.status(500).json({ error: 'Failed to fetch platform stats' });
  }
};

// ─── Platform Admin: Subscription Plans ─────────────────────────────────
exports.getPlans = async (req, res) => {
  try {
    const plans = await getSubscriptionPlansCatalog();
    res.json({ plans });
  } catch (e) {
    console.error('getPlans', e);
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
};

// ─── Platform Admin: Renewal Calendar ───────────────────────────────────
exports.getRenewalCalendar = async (req, res) => {
  try {
    if (!isPlatformRole(req.user.role)) {
      return res.status(403).json({ error: 'Platform admin access required' });
    }

    const { days = 30 } = req.query;
    const futureDate = new Date(Date.now() + parseInt(days) * 86400000).toISOString().split('T')[0];

    const result = await pool.query(`
      SELECT id, name, subscription_plan, subscription_status,
             renewal_date, total_units,
             contact_name, contact_email, contact_phone
      FROM platform.societies
      WHERE subscription_status IN ('ACTIVE', 'TRIAL')
        AND (renewal_date IS NULL OR renewal_date <= $1)
      ORDER BY COALESCE(renewal_date, NOW()) ASC
    `, [futureDate]);

    res.json({ renewals: result.rows });
  } catch (error) {
    console.error('Renewal calendar error:', error);
    res.status(500).json({ error: 'Failed to fetch renewal calendar' });
  }
};

// ─── Platform Admin: Request KYC Re-Upload ──────────────────────────
exports.requestReUpload = async (req, res) => {
  try {
    if (!isPlatformRole(req.user.role)) return res.status(403).json({ error: 'Platform admin access required' });
    const { society_id, remarks } = req.body;
    if (!remarks) return res.status(400).json({ error: 'Remarks are required' });

    const result = await pool.query('SELECT * FROM platform.societies WHERE id = $1', [society_id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Society not found' });

    await pool.query(
      `UPDATE platform.societies SET onboarding_state = $1, kyc_rejection_reason = $2, updated_at = NOW() WHERE id = $3`,
      [ONBOARDING_STATES.KYC_PENDING, remarks, society_id]
    );

    const soc = result.rows[0];
    if (soc.contact_email) sendReUploadRequestEmail(soc.contact_email, soc.name, remarks).catch(e => console.error('Re-upload email failed:', e.message));
    await logAudit(req, 'KYC_REUPLOAD_REQUESTED', 'SOCIETY', society_id, null, { remarks });

    res.json({ message: 'Re-upload requested', state: ONBOARDING_STATES.KYC_PENDING });
  } catch (error) {
    console.error('Request re-upload error:', error);
    res.status(500).json({ error: 'Failed to request re-upload' });
  }
};

// ─── Society: Configuration Wizard ──────────────────────────────────
exports.saveConfiguration = async (req, res) => {
  try {
    const { society_id } = req.body;
    const targetId = society_id || req.user.society_id;
    if (!targetId) return res.status(400).json({ error: 'society_id is required' });

    const { financial_year_start, billing_day, interest_rate_pa, interest_type, billing_heads, gst_registered, gstin, maintenance_amount, sinking_fund, parking_charges } = req.body;

    await pool.query(`
      ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb
    `);

    const config = {
      financial_year_start: financial_year_start || 'APRIL',
      billing_day: billing_day || 1,
      interest_rate_pa: interest_rate_pa || 18,
      interest_type: interest_type || 'SIMPLE',
      billing_heads: billing_heads || ['MAINTENANCE', 'SINKING_FUND', 'PARKING'],
      gst_registered: !!gst_registered,
      gstin: gstin || null,
      maintenance_amount: maintenance_amount || 0,
      sinking_fund: sinking_fund || 0,
      parking_charges: parking_charges || 0,
    };

    await pool.query(
      'UPDATE platform.societies SET config = $1::jsonb, onboarding_state = $2, updated_at = NOW() WHERE id = $3',
      [JSON.stringify(config), ONBOARDING_STATES.CONFIGURATION_WIZARD, targetId]
    );

    await logAudit(req, 'CONFIGURATION_SAVED', 'SOCIETY', targetId, null, config);
    res.json({ message: 'Configuration saved', config });
  } catch (error) {
    console.error('Save configuration error:', error);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
};

// ─── Get Onboarding Progress ─────────────────────────────────────────
exports.getOnboardingProgress = async (req, res) => {
  try {
    const societyId = req.params.id || req.user.society_id;
    const result = await pool.query('SELECT onboarding_state, config, kyc_documents, contact_email, contact_name FROM platform.societies WHERE id = $1', [societyId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Society not found' });

    const soc = result.rows[0];
    const STEPS = [
      { key: 'REGISTRATION_FORM', label: 'Registration' },
      { key: 'EMAIL_VERIFICATION', label: 'Email Verification' },
      { key: 'KYC_PENDING', label: 'KYC Documents' },
      { key: 'KYC_UNDER_REVIEW', label: 'KYC Review' },
      { key: 'KYC_APPROVED', label: 'KYC Approved' },
      { key: 'SCHEMA_PROVISIONED', label: 'Workspace Setup' },
      { key: 'CONFIGURATION_WIZARD', label: 'Configuration' },
      { key: 'TRIAL_ACTIVE', label: 'Trial Active' },
      { key: 'ACTIVE', label: 'Active' },
    ];

    const currentIdx = STEPS.findIndex(s => s.key === soc.onboarding_state);
    const completedSteps = currentIdx >= 0 ? currentIdx + 1 : 0;
    const totalSteps = STEPS.length;
    const pct = Math.round((completedSteps / totalSteps) * 100);

    res.json({
      current_state: soc.onboarding_state,
      steps: STEPS.map((s, i) => ({ ...s, status: i < completedSteps ? 'completed' : i === completedSteps ? 'current' : 'pending' })),
      completed: completedSteps,
      total: totalSteps,
      progress_pct: pct,
    });
  } catch (error) {
    console.error('Onboarding progress error:', error);
    res.status(500).json({ error: 'Failed to get progress' });
  }
};

// ─── Platform Admin: Activate Trial ─────────────────────────────────
exports.activateTrial = async (req, res) => {
  try {
    if (!isPlatformRole(req.user.role)) return res.status(403).json({ error: 'Platform admin access required' });
    const { society_id, trial_days } = req.body;
    const days = parseInt(trial_days) || 30;
    const trialEnd = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];

    await pool.query(`
      UPDATE platform.societies SET
        subscription_status = 'TRIAL', onboarding_state = $1, renewal_date = $2::date, updated_at = NOW()
      WHERE id = $3
    `, [ONBOARDING_STATES.TRIAL_ACTIVE, trialEnd, society_id]);

    await logAudit(req, 'TRIAL_ACTIVATED', 'SOCIETY', society_id, null, { trial_days: days, trial_end: trialEnd });
    res.json({ message: 'Trial activated', trial_end: trialEnd });
  } catch (error) {
    console.error('Activate trial error:', error);
    res.status(500).json({ error: 'Failed to activate trial' });
  }
};

// ─── Annual Pricing Helper ──────────────────────────────────────────
exports.calculatePricing = async (req, res) => {
  try {
    const { plan, total_units, billing_cycle } = req.query;
    const catalog = await getSubscriptionPlansCatalog();
    const planKey = String(plan || 'CORE').trim().toUpperCase();
    const planDef = catalog[planKey];
    if (!planDef) return res.status(400).json({ error: 'Invalid plan' });

    const units = parseInt(total_units) || 1;
    const monthly = planDef.pricePerUnit * units;
    const isAnnual = billing_cycle === 'ANNUAL';
    const discount = isAnnual ? 0.15 : 0;
    const total = isAnnual ? monthly * 12 * (1 - discount) : monthly;
    const gst = total * 0.18;

    res.json({
      plan: planKey,
      price_per_unit: planDef.pricePerUnit,
      units,
      billing_cycle: isAnnual ? 'ANNUAL' : 'MONTHLY',
      subtotal: Math.round(total),
      discount_pct: Math.round(discount * 100),
      gst: Math.round(gst),
      grand_total: Math.round(total + gst),
      features: planDef.features,
    });
  } catch (error) {
    console.error('Calculate pricing error:', error);
    res.status(500).json({ error: 'Failed to calculate pricing' });
  }
};

exports.ONBOARDING_STATES = ONBOARDING_STATES;
exports.SUBSCRIPTION_PLANS = SUBSCRIPTION_PLANS;
exports.getSubscriptionPlansCatalog = getSubscriptionPlansCatalog;