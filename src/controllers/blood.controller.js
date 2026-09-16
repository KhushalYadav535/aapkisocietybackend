const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, withTenant, isPostgresEnabled } = require('../config/postgres');

const ensureBloodTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS blood_requests (
      id TEXT PRIMARY KEY,
      society_id TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      flat_number TEXT NOT NULL,
      wing TEXT,
      blood_group_needed TEXT NOT NULL,
      patient_name TEXT,
      hospital_name TEXT NOT NULL,
      contact_phone TEXT NOT NULL,
      units_needed INTEGER DEFAULT 1,
      urgency TEXT DEFAULT 'URGENT',
      status TEXT DEFAULT 'ACTIVE',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getDonors = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) return res.status(400).json({ error: 'Society ID missing' });

    if (isPostgresEnabled && pool) {
      const q = `
        SELECT id, first_name, last_name, phone, flat_number, wing, blood_group
        FROM platform.users
        WHERE society_id = $1 AND blood_group IS NOT NULL AND blood_group != ''
        ORDER BY first_name ASC
      `;
      const r = await pool.query(q, [societyId]);
      return res.json({ donors: r.rows });
    }

    const db = getDb();
    const donors = (db.get('users').value() || [])
      .filter(u => u.society_id === societyId && u.blood_group)
      .map(u => ({
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        phone: u.phone,
        flat_number: u.flat_number,
        wing: u.wing,
        blood_group: u.blood_group
      }));
    return res.json({ donors });
  } catch (error) {
    console.error('Fetch blood donors error:', error);
    return res.status(500).json({ error: 'Server error fetching blood donors' });
  }
};

exports.updateBloodGroup = async (req, res) => {
  try {
    const userId = req.user.id;
    const { blood_group } = req.body;

    if (!blood_group) {
      return res.status(400).json({ error: 'Blood group is required' });
    }

    const validGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    if (!validGroups.includes(blood_group.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid blood group' });
    }

    const bg = blood_group.toUpperCase();

    if (isPostgresEnabled && pool) {
      await pool.query('UPDATE platform.users SET blood_group = $1 WHERE id = $2', [bg, userId]);
      return res.json({ success: true, blood_group: bg });
    }

    const db = getDb();
    db.get('users').find({ id: userId }).assign({ blood_group: bg }).write();
    return res.json({ success: true, blood_group: bg });
  } catch (error) {
    console.error('Update blood group error:', error);
    return res.status(500).json({ error: 'Server error updating blood group' });
  }
};

exports.getRequests = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) return res.status(400).json({ error: 'Society ID missing' });

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureBloodTable(client);
        const r = await client.query(
          `SELECT * FROM blood_requests WHERE society_id = $1 ORDER BY created_at DESC`,
          [societyId]
        );
        return res.json({ requests: r.rows });
      });
    }

    const db = getDb();
    const requests = (db.get('blood_requests').value() || [])
      .filter(r => r.society_id === societyId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return res.json({ requests });
  } catch (error) {
    console.error('Fetch blood requests error:', error);
    return res.status(500).json({ error: 'Server error fetching blood requests' });
  }
};

exports.createRequest = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) return res.status(400).json({ error: 'Society ID missing' });

    const {
      blood_group_needed,
      patient_name,
      hospital_name,
      contact_phone,
      units_needed,
      urgency,
      notes
    } = req.body;

    if (!blood_group_needed || !hospital_name || !contact_phone) {
      return res.status(400).json({ error: 'Blood group, hospital name, and contact phone are required' });
    }

    const id = uuidv4();
    const requesterName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Resident';

    const newRequest = {
      id,
      society_id: societyId,
      requester_id: req.user.id,
      requester_name: requesterName,
      flat_number: req.user.flat_number || 'N/A',
      wing: req.user.wing || 'A',
      blood_group_needed: blood_group_needed.toUpperCase(),
      patient_name: patient_name ? patient_name.trim() : null,
      hospital_name: hospital_name.trim(),
      contact_phone: contact_phone.trim(),
      units_needed: parseInt(units_needed) || 1,
      urgency: urgency || 'URGENT',
      status: 'ACTIVE',
      notes: notes ? notes.trim() : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureBloodTable(client);
        const q = `
          INSERT INTO blood_requests (
            id, society_id, requester_id, requester_name, flat_number, wing,
            blood_group_needed, patient_name, hospital_name, contact_phone,
            units_needed, urgency, status, notes, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
          RETURNING *
        `;
        const r = await client.query(q, [
          newRequest.id, newRequest.society_id, newRequest.requester_id, newRequest.requester_name,
          newRequest.flat_number, newRequest.wing, newRequest.blood_group_needed, newRequest.patient_name,
          newRequest.hospital_name, newRequest.contact_phone, newRequest.units_needed, newRequest.urgency,
          newRequest.status, newRequest.notes
        ]);
        return res.status(201).json({ success: true, request: r.rows[0] });
      });
    }

    const db = getDb();
    if (!db.get('blood_requests').value()) {
      db.set('blood_requests', []).write();
    }
    db.get('blood_requests').push(newRequest).write();
    return res.status(201).json({ success: true, request: newRequest });
  } catch (error) {
    console.error('Create blood request error:', error);
    return res.status(500).json({ error: 'Server error creating blood request' });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const societyId = req.user.society_id;

    if (!['ACTIVE', 'FULFILLED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureBloodTable(client);
        const r = await client.query(
          `UPDATE blood_requests SET status = $1, updated_at = NOW() WHERE id = $2 AND society_id = $3 RETURNING *`,
          [status, id, societyId]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'Blood request not found' });
        return res.json({ success: true, request: r.rows[0] });
      });
    }

    const db = getDb();
    const item = db.get('blood_requests').find({ id, society_id: societyId }).value();
    if (!item) return res.status(404).json({ error: 'Blood request not found' });
    db.get('blood_requests').find({ id, society_id: societyId }).assign({ status, updated_at: new Date().toISOString() }).write();
    return res.json({ success: true, request: { ...item, status } });
  } catch (error) {
    console.error('Update blood request error:', error);
    return res.status(500).json({ error: 'Server error updating blood request' });
  }
};
