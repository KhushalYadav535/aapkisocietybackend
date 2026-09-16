const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled } = require('../config/postgres');

const ensureMoveRequestTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS move_requests (
      id TEXT PRIMARY KEY,
      society_id TEXT NOT NULL,
      user_id TEXT,
      request_type TEXT NOT NULL,
      applicant_name TEXT NOT NULL,
      applicant_phone TEXT NOT NULL,
      applicant_email TEXT,
      flat_number TEXT NOT NULL,
      wing TEXT NOT NULL,
      move_date DATE NOT NULL,
      time_slot TEXT NOT NULL,
      vehicle_number TEXT,
      mover_agency TEXT,
      status TEXT DEFAULT 'PENDING',
      rejection_reason TEXT,
      approved_by TEXT,
      approved_at TIMESTAMPTZ,
      certificate_number TEXT,
      verification_token TEXT,
      documents JSONB DEFAULT '[]'::jsonb,
      lift_charges_paid INTEGER DEFAULT 0,
      security_deposit NUMERIC DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getAll = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) return res.status(400).json({ error: 'Society ID missing' });

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureMoveRequestTable(client);
        let query = 'SELECT * FROM move_requests WHERE society_id = $1';
        let params = [societyId];

        if (req.user.role === 'RESIDENT') {
          params.push(req.user.id);
          query += ` AND (user_id = $${params.length}`;
          if (req.user.flat_number) {
            params.push(req.user.flat_number);
            query += ` OR flat_number = $${params.length}`;
          }
          query += ')';
        }

        query += ' ORDER BY created_at DESC';
        const r = await client.query(query, params);
        return res.json({ requests: r.rows });
      }).catch((err) => {
        console.error('Fetch move_requests error:', err);
        return res.status(500).json({ error: 'Failed to fetch move requests' });
      });
    }

    const db = getDb();
    let requests = (db.get('move_requests').value() || []).filter(r => r.society_id === societyId);
    if (req.user.role === 'RESIDENT') {
      requests = requests.filter(r => r.user_id === req.user.id || (req.user.flat_number && r.flat_number === req.user.flat_number));
    }
    requests.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return res.json({ requests });
  } catch (error) {
    console.error('getAll move_requests error:', error);
    return res.status(500).json({ error: 'Failed to fetch move requests' });
  }
};

exports.getById = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const { id } = req.params;

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureMoveRequestTable(client);
        const r = await client.query('SELECT * FROM move_requests WHERE id = $1 AND society_id = $2', [id, societyId]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Move request not found' });
        return res.json({ request: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch move request' }));
    }

    const db = getDb();
    const request = (db.get('move_requests').value() || []).find(r => r.id === id);
    if (!request) return res.status(404).json({ error: 'Move request not found' });
    return res.json({ request });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch move request' });
  }
};

exports.create = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) return res.status(400).json({ error: 'Society ID missing' });

    const {
      request_type = 'MOVE_IN',
      applicant_name,
      applicant_phone,
      applicant_email = '',
      flat_number,
      wing = '',
      move_date,
      time_slot = '10:00 AM - 02:00 PM',
      vehicle_number = '',
      mover_agency = '',
      documents = [],
      notes = '',
      lift_charges_paid = 0,
      security_deposit = 0
    } = req.body;

    if (!applicant_name || !applicant_phone || !flat_number || !move_date) {
      return res.status(400).json({ error: 'Applicant name, phone, flat number, and move date are required' });
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureMoveRequestTable(client);
        const q = `
          INSERT INTO move_requests (
            id, society_id, user_id, request_type, applicant_name, applicant_phone,
            applicant_email, flat_number, wing, move_date, time_slot, vehicle_number,
            mover_agency, status, documents, lift_charges_paid, security_deposit, notes,
            created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'PENDING',
            $14, $15, $16, $17, $18, $18
          ) RETURNING *
        `;
        const r = await client.query(q, [
          id, societyId, req.user.id, request_type, applicant_name, applicant_phone,
          applicant_email, flat_number, wing, move_date, time_slot, vehicle_number,
          mover_agency, JSON.stringify(documents), lift_charges_paid ? 1 : 0,
          parseFloat(security_deposit) || 0, notes, now
        ]);

        return res.status(201).json({ message: 'Move request submitted successfully', request: r.rows[0] });
      }).catch((err) => {
        console.error('Create move_request error:', err);
        return res.status(500).json({ error: 'Failed to create move request' });
      });
    }

    const db = getDb();
    const newRequest = {
      id,
      society_id: societyId,
      user_id: req.user.id,
      request_type,
      applicant_name,
      applicant_phone,
      applicant_email,
      flat_number,
      wing,
      move_date,
      time_slot,
      vehicle_number,
      mover_agency,
      status: 'PENDING',
      documents,
      lift_charges_paid: lift_charges_paid ? 1 : 0,
      security_deposit: parseFloat(security_deposit) || 0,
      notes,
      created_at: now,
      updated_at: now
    };
    const list = db.get('move_requests').value() || [];
    list.unshift(newRequest);
    db.set('move_requests', list).write();
    return res.status(201).json({ message: 'Move request submitted successfully', request: newRequest });
  } catch (error) {
    console.error('Create move_request catch error:', error);
    return res.status(500).json({ error: 'Failed to create move request' });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const { id } = req.params;
    const { status, rejection_reason = '' } = req.body;

    if (!['APPROVED', 'REJECTED', 'COMPLETED', 'PENDING'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const now = new Date().toISOString();
    const year = new Date().getFullYear();

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureMoveRequestTable(client);
        const sel = await client.query('SELECT * FROM move_requests WHERE id = $1 AND society_id = $2', [id, societyId]);
        const existing = sel.rows[0];
        if (!existing) return res.status(404).json({ error: 'Request not found' });

        let certificate_number = existing.certificate_number;
        let verification_token = existing.verification_token;
        let approved_by = existing.approved_by;
        let approved_at = existing.approved_at;

        if (status === 'APPROVED' && !certificate_number) {
          const flatCode = (existing.flat_number || 'FLAT').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          const randomHex = Math.random().toString(36).substring(2, 6).toUpperCase();
          certificate_number = `NOC-${year}-${existing.wing ? existing.wing + '-' : ''}${flatCode}-${randomHex}`;
          verification_token = uuidv4();
          approved_by = `${req.user.first_name} ${req.user.last_name || ''}`.trim() || 'Society Committee';
          approved_at = now;
        }

        const upd = await client.query(`
          UPDATE move_requests
          SET status = $1, rejection_reason = $2, certificate_number = $3,
              verification_token = $4, approved_by = $5, approved_at = $6, updated_at = $7
          WHERE id = $8 AND society_id = $9
          RETURNING *
        `, [status, rejection_reason, certificate_number, verification_token, approved_by, approved_at, now, id, societyId]);

        return res.json({ message: `Move request ${status.toLowerCase()} successfully`, request: upd.rows[0] });
      }).catch((err) => {
        console.error('updateStatus move_request error:', err);
        return res.status(500).json({ error: 'Failed to update move request' });
      });
    }

    const db = getDb();
    const list = db.get('move_requests').value() || [];
    const item = list.find(r => r.id === id);
    if (!item) return res.status(404).json({ error: 'Request not found' });

    item.status = status;
    item.rejection_reason = rejection_reason;
    item.updated_at = now;

    if (status === 'APPROVED' && !item.certificate_number) {
      item.certificate_number = `NOC-${year}-${item.flat_number}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      item.verification_token = uuidv4();
      item.approved_by = `${req.user.first_name} ${req.user.last_name || ''}`.trim();
      item.approved_at = now;
    }

    db.set('move_requests', list).write();
    return res.json({ message: `Move request ${status.toLowerCase()} successfully`, request: item });
  } catch (error) {
    console.error('updateStatus catch error:', error);
    return res.status(500).json({ error: 'Failed to update move request' });
  }
};

exports.verifyNoc = async (req, res) => {
  try {
    const { certificate_number } = req.query;
    if (!certificate_number) {
      return res.status(400).json({ error: 'Certificate number required' });
    }

    if (isPostgresEnabled && req.user?.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureMoveRequestTable(client);
        const r = await client.query(`
          SELECT id, request_type, applicant_name, flat_number, wing, move_date, time_slot,
                 vehicle_number, mover_agency, status, certificate_number, approved_by, approved_at
          FROM move_requests
          WHERE certificate_number = $1
        `, [certificate_number]);

        if (r.rowCount === 0) {
          return res.status(404).json({ valid: false, message: 'NOC Certificate not found or invalid' });
        }
        const cert = r.rows[0];
        return res.json({
          valid: cert.status === 'APPROVED' || cert.status === 'COMPLETED',
          certificate: cert
        });
      });
    }

    return res.status(404).json({ valid: false, message: 'NOC Certificate verification unavailable' });
  } catch (error) {
    return res.status(500).json({ valid: false, error: 'Verification error' });
  }
};
