const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled } = require('../config/postgres');

const matchesUnit = (itemFlat, itemWing, userFlat, userWing) => {
  if (!userFlat) return false;
  const f1 = String(itemFlat || '').trim().toUpperCase();
  const w1 = String(itemWing || '').trim().toUpperCase();
  const f2 = String(userFlat || '').trim().toUpperCase();
  const w2 = String(userWing || '').trim().toUpperCase();

  if (f1 === f2 && (!w1 || !w2 || w1 === w2)) return true;
  if (w2 && (f1 === `${w2}-${f2}` || f1 === `${w2}${f2}`)) return true;
  if (w1 && (f2 === `${w1}-${f1}` || f2 === `${w1}${f1}`)) return true;
  const c1 = (w1 + f1).replace(/[^A-Z0-9]/g, '');
  const c2 = (w2 + f2).replace(/[^A-Z0-9]/g, '');
  if (c1 && c2 && (c1 === c2 || c1 === f2.replace(/[^A-Z0-9]/g, '') || c2 === f1.replace(/[^A-Z0-9]/g, ''))) return true;
  return false;
};

const ensureViolationTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS rule_violations (
      id TEXT PRIMARY KEY,
      society_id TEXT NOT NULL,
      reported_by_id TEXT NOT NULL,
      reported_by_name TEXT NOT NULL,
      reported_by_flat TEXT,
      reported_by_wing TEXT,
      violator_flat TEXT,
      violator_wing TEXT,
      violator_vehicle_number TEXT,
      violation_type TEXT NOT NULL,
      description TEXT NOT NULL,
      photo_url TEXT,
      fine_amount NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'REPORTED',
      committee_notes TEXT,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getAll = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) return res.status(400).json({ error: 'Society ID missing from user profile' });

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureViolationTable(client);
        let query = 'SELECT * FROM rule_violations WHERE society_id = $1';
        let params = [societyId];

        // If resident, they can see violations they reported OR violations against their flat
        if (req.user.role === 'RESIDENT' && req.user.flat_number) {
          const userFlat = String(req.user.flat_number || '').trim();
          const userWing = String(req.user.wing || '').trim();
          const combined = userWing ? `${userWing}-${userFlat}` : userFlat;
          const cleanUser = (userWing + userFlat).replace(/[^A-Za-z0-9]/g, '');
          params.push(req.user.id, userFlat, combined, cleanUser);
          const pId = params.length - 3;
          const pFlat = params.length - 2;
          const pComb = params.length - 1;
          const pClean = params.length;
          query += ` AND (
            reported_by_id = $${pId}
            OR violator_flat = $${pFlat}
            OR violator_flat = $${pComb}
            OR REPLACE(REPLACE(violator_flat, '-', ''), ' ', '') = $${pClean}
            OR REPLACE(REPLACE(CONCAT(violator_wing, violator_flat), '-', ''), ' ', '') = $${pClean}
          )`;
        }

        query += ' ORDER BY created_at DESC';
        const r = await client.query(query, params);
        return res.json({ violations: r.rows });
      }).catch((err) => {
        console.error('Fetch violations error:', err);
        return res.status(500).json({ error: 'Failed to fetch violations' });
      });
    }

    const db = getDb();
    let violations = (db.get('rule_violations').value() || []).filter(v => v.society_id === societyId);
    if (req.user.role === 'RESIDENT' && req.user.flat_number) {
      violations = violations.filter(v => 
        v.reported_by_id === req.user.id || 
        matchesUnit(v.violator_flat, v.violator_wing, req.user.flat_number, req.user.wing)
      );
    }
    return res.json({ violations });
  } catch (error) {
    console.error('Fetch violations error:', error);
    return res.status(500).json({ error: 'Server error fetching violations' });
  }
};

exports.create = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) return res.status(400).json({ error: 'Society ID missing' });

    const {
      violator_flat,
      violator_wing,
      violator_vehicle_number,
      violation_type,
      description,
      photo_url
    } = req.body;

    if (!violation_type || !description) {
      return res.status(400).json({ error: 'Violation type and description are required' });
    }

    const id = uuidv4();
    const reportedById = req.user.id;
    const reportedByName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Resident';
    const reportedByFlat = req.user.flat_number || 'N/A';
    const reportedByWing = req.user.wing || 'A';

    const newViolation = {
      id,
      society_id: societyId,
      reported_by_id: reportedById,
      reported_by_name: reportedByName,
      reported_by_flat: reportedByFlat,
      reported_by_wing: reportedByWing,
      violator_flat: violator_flat ? violator_flat.trim() : null,
      violator_wing: violator_wing ? violator_wing.trim() : null,
      violator_vehicle_number: violator_vehicle_number ? violator_vehicle_number.trim().toUpperCase() : null,
      violation_type,
      description: description.trim(),
      photo_url: photo_url || null,
      fine_amount: 0,
      status: 'REPORTED',
      committee_notes: null,
      resolved_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureViolationTable(client);
        const insertQuery = `
          INSERT INTO rule_violations (
            id, society_id, reported_by_id, reported_by_name, reported_by_flat, reported_by_wing,
            violator_flat, violator_wing, violator_vehicle_number, violation_type, description,
            photo_url, fine_amount, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
          RETURNING *
        `;
        const r = await client.query(insertQuery, [
          newViolation.id, newViolation.society_id, newViolation.reported_by_id, newViolation.reported_by_name,
          newViolation.reported_by_flat, newViolation.reported_by_wing, newViolation.violator_flat,
          newViolation.violator_wing, newViolation.violator_vehicle_number, newViolation.violation_type,
          newViolation.description, newViolation.photo_url, newViolation.fine_amount, newViolation.status
        ]);
        return res.status(201).json({ success: true, violation: r.rows[0] });
      }).catch((err) => {
        console.error('Create violation error:', err);
        return res.status(500).json({ error: 'Failed to record violation' });
      });
    }

    const db = getDb();
    if (!db.get('rule_violations').value()) {
      db.set('rule_violations', []).write();
    }
    db.get('rule_violations').push(newViolation).write();
    return res.status(201).json({ success: true, violation: newViolation });
  } catch (error) {
    console.error('Create violation error:', error);
    return res.status(500).json({ error: 'Server error creating violation' });
  }
};

exports.updateAction = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, fine_amount, committee_notes } = req.body;
    const societyId = req.user.society_id;

    if (!['REPORTED', 'UNDER_REVIEW', 'WARNING_ISSUED', 'FINED', 'RESOLVED', 'DISMISSED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid violation status' });
    }

    const fine = fine_amount !== undefined ? parseFloat(fine_amount) : undefined;
    const resolvedAt = ['RESOLVED', 'DISMISSED'].includes(status) ? new Date().toISOString() : null;

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureViolationTable(client);
        const r = await client.query(
          `UPDATE rule_violations 
           SET status = $1, 
               fine_amount = COALESCE($2, fine_amount), 
               committee_notes = COALESCE($3, committee_notes),
               resolved_at = CASE WHEN $1 IN ('RESOLVED', 'DISMISSED') THEN NOW() ELSE resolved_at END,
               updated_at = NOW() 
           WHERE id = $4 AND society_id = $5 RETURNING *`,
          [status, fine, committee_notes, id, societyId]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'Violation ticket not found' });
        return res.json({ success: true, violation: r.rows[0] });
      });
    }

    const db = getDb();
    const item = db.get('rule_violations').find({ id, society_id: societyId }).value();
    if (!item) return res.status(404).json({ error: 'Violation ticket not found' });

    const updated = {
      ...item,
      status,
      fine_amount: fine !== undefined ? fine : item.fine_amount,
      committee_notes: committee_notes !== undefined ? committee_notes : item.committee_notes,
      resolved_at: resolvedAt,
      updated_at: new Date().toISOString()
    };
    db.get('rule_violations').find({ id, society_id: societyId }).assign(updated).write();
    return res.json({ success: true, violation: updated });
  } catch (error) {
    console.error('Update violation action error:', error);
    return res.status(500).json({ error: 'Server error updating violation action' });
  }
};
