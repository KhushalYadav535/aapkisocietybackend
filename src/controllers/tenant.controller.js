const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, ensurePlatformSchema } = require('../config/postgres');

const STATUS = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED', EXPIRED: 'EXPIRED' };

const ensureTenantTables = async (societyId) => {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS \"society_${societyId}\"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \"society_${societyId}\".tenants (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      flat_id TEXT,
      owner_id TEXT,
      tenant_name TEXT,
      tenant_email TEXT,
      tenant_phone TEXT,
      lease_start DATE,
      lease_end DATE,
      rent_amount NUMERIC,
      status TEXT DEFAULT 'PENDING',
      rejection_reason TEXT,
      termination_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getAll = (req, res) => {
  try {
    const { status } = req.query;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureTenantTables(societyId).then(async () => {
        let query = `SELECT t.*, u.flat_number, u.wing, o.first_name as owner_name, o.last_name as owner_last_name
          FROM \"society_${societyId}\".tenants t
          JOIN platform.users u ON u.id = t.flat_id
          JOIN platform.users o ON o.id = t.owner_id
          WHERE t.society_id = $1`;
        const params = [societyId];
        let idx = 2;

        if (status) { query += ` AND t.status = $${idx++}`; params.push(status); }
        query += ' ORDER BY t.created_at DESC';

        const r = await pool.query(query, params);
        return res.json({ tenants: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch tenants' }));
    }

    const db = getDb();
    let tenants = db.get('tenants').filter(t => t.society_id === societyId).value();
    const users = db.get('users').value();

    if (status) tenants = tenants.filter(t => t.status === status);

    tenants = tenants.map(t => {
      const flat = users.find(u => u.id === t.flat_id);
      const owner = users.find(u => u.id === t.owner_id);
      return { ...t, flat_number: flat?.flat_number, wing: flat?.wing, owner_name: owner?.first_name, owner_last_name: owner?.last_name };
    });

    res.json({ tenants: tenants.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
};

exports.create = (req, res) => {
  try {
    const { flat_id, tenant_name, tenant_email, tenant_phone, lease_start, lease_end, rent_amount, owner_id } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    const isOwner = req.user.flat_id === flat_id || req.user.role === 'ADMIN';
    if (!isOwner) return res.status(403).json({ error: 'Only flat owner can add tenant' });

    if (isPostgresEnabled) {
      return ensureTenantTables(societyId).then(async () => {
        const id = uuidv4();
        let tempPassword = 'Tenant@' + Math.random().toString(36).slice(2, 8);
        const hashed = await bcrypt.hash(tempPassword, 10);

        await pool.query(
          `INSERT INTO \"society_${societyId}\".tenants (id, society_id, flat_id, owner_id, tenant_name, tenant_email, tenant_phone, lease_start, lease_end, rent_amount, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [id, societyId, flat_id, owner_id || req.user.id, tenant_name, tenant_email, tenant_phone, lease_start, lease_end, rent_amount, STATUS.PENDING, now]
        );

        if (tenant_email) {
          await pool.query(
            `INSERT INTO platform.users (id, email, password, first_name, phone, role, society_id, flat_number, wing, is_active, is_verified, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, 1, $10)`,
            [uuidv4(), tenant_email, hashed, tenant_name, tenant_phone, 'RESIDENT', societyId, null, null, now]
          );
        }

        const r = await pool.query(`SELECT * FROM \"society_${societyId}\".tenants WHERE id = $1`, [id]);
        return res.status(201).json({ tenant: r.rows[0], tempPassword: tenant_email ? tempPassword : null });
      }).catch(() => res.status(500).json({ error: 'Failed to create tenant' }));
    }

    const db = getDb();
    const tenant = {
      id: uuidv4(), society_id: societyId, flat_id, owner_id: owner_id || req.user.id,
      tenant_name, tenant_email, tenant_phone,
      lease_start, lease_end, rent_amount,
      status: STATUS.PENDING, created_at: now, updated_at: now
    };

    if (!db.get('tenants').value()) db.set('tenants', []).write();
    db.get('tenants').push(tenant).write();

    if (tenant_email) {
      const tempPassword = 'Tenant@' + Math.random().toString(36).slice(2, 8);
      const hashed = bcrypt.hashSync(tempPassword, 10);
      db.get('users').push({
        id: uuidv4(), email: tenant_email, password: hashed, first_name: tenant_name,
        phone: tenant_phone, role: 'RESIDENT', society_id: societyId,
        flat_number: null, wing: null, is_active: 1, is_verified: 1, created_at: now
      }).write();
      tenant._tempPassword = tempPassword;
    }

    res.status(201).json({ tenant });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create tenant' });
  }
};

exports.approve = (req, res) => {
  try {
    const { id } = req.params;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (!['ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'].includes(req.user.role)) return res.status(403).json({ error: 'Not authorized' });

    if (isPostgresEnabled) {
      return ensureTenantTables(societyId).then(async () => {
        await pool.query(`UPDATE \"society_${societyId}\".tenants SET status = $1, updated_at = $2 WHERE id = $3`, [STATUS.APPROVED, now, id]);
        const r = await pool.query(`SELECT * FROM \"society_${societyId}\".tenants WHERE id = $1`, [id]);
        return res.json({ tenant: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to approve tenant' }));
    }

    const db = getDb();
    db.get('tenants').find({ id }).assign({ status: STATUS.APPROVED, updated_at: now }).write();
    res.json({ tenant: db.get('tenants').find({ id }).value() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve tenant' });
  }
};

exports.reject = (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (!['ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'].includes(req.user.role)) return res.status(403).json({ error: 'Not authorized' });

    if (isPostgresEnabled) {
      return ensureTenantTables(societyId).then(async () => {
        await pool.query(`UPDATE \"society_${societyId}\".tenants SET status = $1, rejection_reason = $2, updated_at = $3 WHERE id = $4`, [STATUS.REJECTED, reason, now, id]);
        return res.json({ message: 'Tenant rejected' });
      }).catch(() => res.status(500).json({ error: 'Failed to reject tenant' }));
    }

    const db = getDb();
    db.get('tenants').find({ id }).assign({ status: STATUS.REJECTED, rejection_reason: reason, updated_at: now }).write();
    res.json({ message: 'Tenant rejected' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject tenant' });
  }
};

exports.extendLease = (req, res) => {
  try {
    const { id } = req.params;
    const { lease_end, rent_amount } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    const tenant = isPostgresEnabled
      ? null
      : (db => db.get('tenants').find({ id }).value())(getDb());

    if (tenant && tenant.owner_id !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only owner can extend lease' });
    }

    if (isPostgresEnabled) {
      return ensureTenantTables(societyId).then(async () => {
        await pool.query(
          `UPDATE \"society_${societyId}\".tenants SET lease_end = $1, rent_amount = COALESCE($2, rent_amount), updated_at = $3 WHERE id = $4`,
          [lease_end, rent_amount, now, id]
        );
        const r = await pool.query(`SELECT * FROM \"society_${societyId}\".tenants WHERE id = $1`, [id]);
        return res.json({ tenant: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to extend lease' }));
    }

    const db = getDb();
    const updates = { lease_end, updated_at: now };
    if (rent_amount) updates.rent_amount = rent_amount;
    db.get('tenants').find({ id }).assign(updates).write();
    res.json({ tenant: db.get('tenants').find({ id }).value() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to extend lease' });
  }
};

exports.terminate = (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      return ensureTenantTables(societyId).then(async () => {
        await pool.query(
          `UPDATE \"society_${societyId}\".tenants SET status = $1, termination_reason = $2, lease_end = $3, updated_at = $4 WHERE id = $5`,
          [STATUS.EXPIRED, reason, now.split('T')[0], now, id]
        );
        return res.json({ message: 'Tenant terminated' });
      }).catch(() => res.status(500).json({ error: 'Failed to terminate tenant' }));
    }

    const db = getDb();
    db.get('tenants').find({ id }).assign({
      status: STATUS.EXPIRED, termination_reason: reason,
      lease_end: now.split('T')[0], updated_at: now
    }).write();
    res.json({ message: 'Tenant terminated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to terminate tenant' });
  }
};

exports.getMyTenants = (req, res) => {
  try {
    const userId = req.user.id;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureTenantTables(societyId).then(async () => {
        const r = await pool.query(
          `SELECT * FROM \"society_${societyId}\".tenants WHERE owner_id = $1 ORDER BY created_at DESC`,
          [userId]
        );
        return res.json({ tenants: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch tenants' }));
    }

    const db = getDb();
    const tenants = db.get('tenants').filter(t => t.owner_id === userId).value();
    res.json({ tenants: tenants.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
};