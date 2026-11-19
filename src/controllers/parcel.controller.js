const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled, ensureTenantFeatureTables } = require('../config/postgres');

const ensureParcelTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS parcels (
      id TEXT PRIMARY KEY,
      society_id TEXT NOT NULL,
      flat_number TEXT NOT NULL,
      wing TEXT NOT NULL,
      recipient_name TEXT,
      delivery_company TEXT NOT NULL,
      tracking_number TEXT,
      parcel_count INTEGER DEFAULT 1,
      pickup_pin TEXT NOT NULL,
      status TEXT DEFAULT 'AT_GATE',
      photo_url TEXT,
      notes TEXT,
      received_by_guard_id TEXT,
      collected_by_name TEXT,
      collected_at TIMESTAMPTZ,
      returned_at TIMESTAMPTZ,
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
        await ensureParcelTable(client);
        let query = 'SELECT * FROM parcels WHERE society_id = $1';
        let params = [societyId];

        if (req.user.role === 'RESIDENT' && req.user.flat_number) {
          params.push(req.user.flat_number);
          query += ` AND flat_number = $${params.length}`;
          if (req.user.wing) {
            params.push(req.user.wing);
            query += ` AND wing = $${params.length}`;
          }
        }

        query += ' ORDER BY created_at DESC';
        const r = await client.query(query, params);
        return res.json({ parcels: r.rows });
      }).catch((err) => {
        console.error('Fetch parcels error:', err);
        return res.status(500).json({ error: 'Failed to fetch parcels' });
      });
    }

    const db = getDb();
    let parcels = (db.get('parcels').value() || []).filter(p => p.society_id === societyId);
    if (req.user.role === 'RESIDENT' && req.user.flat_number) {
      parcels = parcels.filter(p => p.flat_number === req.user.flat_number);
    }
    parcels.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return res.json({ parcels });
  } catch (error) {
    console.error('getAll parcels error:', error);
    return res.status(500).json({ error: 'Failed to fetch parcels' });
  }
};

exports.create = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) return res.status(400).json({ error: 'Society ID missing' });

    const {
      flat_number,
      wing = '',
      recipient_name = '',
      delivery_company,
      tracking_number = '',
      parcel_count = 1,
      notes = '',
      photo_url = ''
    } = req.body;

    if (!flat_number || !delivery_company) {
      return res.status(400).json({ error: 'Flat number and delivery company are required' });
    }

    // Generate random secure 4-digit pickup PIN
    const pickup_pin = Math.floor(1000 + Math.random() * 9000).toString();
    const id = uuidv4();
    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureParcelTable(client);
        const q = `
          INSERT INTO parcels (
            id, society_id, flat_number, wing, recipient_name, delivery_company,
            tracking_number, parcel_count, pickup_pin, status, photo_url, notes,
            received_by_guard_id, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'AT_GATE', $10, $11, $12, $13, $13)
          RETURNING *
        `;
        const r = await client.query(q, [
          id, societyId, flat_number, wing, recipient_name, delivery_company,
          tracking_number, parseInt(parcel_count) || 1, pickup_pin, photo_url, notes,
          req.user.id, now
        ]);

        // Create resident in-app notification
        try {
          await client.query(`
            INSERT INTO platform.notifications (id, user_id, title, body, type, created_at)
            SELECT $1, id, $2, $3, 'PARCEL', NOW()
            FROM platform.users
            WHERE society_id = $4 AND flat_number = $5 AND wing = $6
          `, [
            uuidv4(),
            `Package Arrived from ${delivery_company}`,
            `A parcel has been received at the security gate for Unit ${wing ? wing + '-' : ''}${flat_number}. Your 4-Digit Pickup PIN is ${pickup_pin}.`,
            societyId, flat_number, wing
          ]);
        } catch (_) {}

        return res.status(201).json({ message: 'Parcel logged at gate', parcel: r.rows[0] });
      }).catch((err) => {
        console.error('Create parcel error:', err);
        return res.status(500).json({ error: 'Failed to create parcel' });
      });
    }

    const db = getDb();
    const newParcel = {
      id,
      society_id: societyId,
      flat_number,
      wing,
      recipient_name,
      delivery_company,
      tracking_number,
      parcel_count: parseInt(parcel_count) || 1,
      pickup_pin,
      status: 'AT_GATE',
      photo_url,
      notes,
      received_by_guard_id: req.user.id,
      created_at: now,
      updated_at: now
    };
    const list = db.get('parcels').value() || [];
    list.unshift(newParcel);
    db.set('parcels', list).write();
    return res.status(201).json({ message: 'Parcel logged at gate', parcel: newParcel });
  } catch (error) {
    console.error('Create parcel catch error:', error);
    return res.status(500).json({ error: 'Failed to create parcel' });
  }
};

exports.verifyAndCollect = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const { id } = req.params;
    const { pickup_pin, collected_by_name } = req.body;

    if (!pickup_pin) {
      return res.status(400).json({ error: 'Pickup PIN is required for handover verification' });
    }

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureParcelTable(client);
        const sel = await client.query('SELECT * FROM parcels WHERE id = $1 AND society_id = $2', [id, societyId]);
        const parcel = sel.rows[0];
        if (!parcel) return res.status(404).json({ error: 'Parcel not found' });
        if (parcel.status === 'COLLECTED') return res.status(400).json({ error: 'Parcel is already marked as collected' });

        if (String(parcel.pickup_pin).trim() !== String(pickup_pin).trim()) {
          return res.status(400).json({ error: 'Incorrect Pickup PIN! Please ask the resident for their 4-digit code.' });
        }

        const now = new Date().toISOString();
        const upd = await client.query(`
          UPDATE parcels 
          SET status = 'COLLECTED', collected_at = $1, collected_by_name = $2, updated_at = $1
          WHERE id = $3
          RETURNING *
        `, [now, collected_by_name || req.user.first_name || 'Resident', id]);

        return res.json({ message: 'Parcel handed over successfully!', parcel: upd.rows[0] });
      }).catch((err) => {
        console.error('Verify parcel error:', err);
        return res.status(500).json({ error: 'Verification failed' });
      });
    }

    const db = getDb();
    const list = db.get('parcels').value() || [];
    const parcel = list.find(p => p.id === id);
    if (!parcel) return res.status(404).json({ error: 'Parcel not found' });
    if (String(parcel.pickup_pin).trim() !== String(pickup_pin).trim()) {
      return res.status(400).json({ error: 'Incorrect Pickup PIN! Please ask the resident for their 4-digit code.' });
    }
    parcel.status = 'COLLECTED';
    parcel.collected_at = new Date().toISOString();
    parcel.collected_by_name = collected_by_name || 'Resident';
    db.set('parcels', list).write();
    return res.json({ message: 'Parcel handed over successfully!', parcel });
  } catch (error) {
    console.error('verifyAndCollect error:', error);
    return res.status(500).json({ error: 'Verification failed' });
  }
};

exports.markReturned = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const { id } = req.params;

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureParcelTable(client);
        const now = new Date().toISOString();
        const upd = await client.query(`
          UPDATE parcels 
          SET status = 'RETURNED', returned_at = $1, updated_at = $1
          WHERE id = $2 AND society_id = $3
          RETURNING *
        `, [now, id, societyId]);
        if (upd.rowCount === 0) return res.status(404).json({ error: 'Parcel not found' });
        return res.json({ message: 'Parcel marked returned to courier', parcel: upd.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to update parcel' }));
    }

    const db = getDb();
    const list = db.get('parcels').value() || [];
    const parcel = list.find(p => p.id === id);
    if (!parcel) return res.status(404).json({ error: 'Parcel not found' });
    parcel.status = 'RETURNED';
    parcel.returned_at = new Date().toISOString();
    db.set('parcels', list).write();
    return res.json({ message: 'Parcel marked returned to courier', parcel });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to return parcel' });
  }
};

exports.getStats = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) return res.status(400).json({ error: 'Society ID missing' });

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureParcelTable(client);
        let residentFilter = '';
        const params = [societyId];
        if (req.user.role === 'RESIDENT' && req.user.flat_number) {
          residentFilter = ' AND flat_number = $2';
          params.push(req.user.flat_number);
        }

        const atGateRes = await client.query(`SELECT COUNT(*)::int as count FROM parcels WHERE society_id = $1 AND status = 'AT_GATE'${residentFilter}`, params);
        const collectedTodayRes = await client.query(`SELECT COUNT(*)::int as count FROM parcels WHERE society_id = $1 AND status = 'COLLECTED' AND collected_at::date = CURRENT_DATE${residentFilter}`, params);
        const overdueRes = await client.query(`SELECT COUNT(*)::int as count FROM parcels WHERE society_id = $1 AND status = 'AT_GATE' AND created_at < NOW() - INTERVAL '48 hours'${residentFilter}`, params);

        return res.json({
          stats: {
            at_gate: atGateRes.rows[0]?.count || 0,
            collected_today: collectedTodayRes.rows[0]?.count || 0,
            overdue: overdueRes.rows[0]?.count || 0
          }
        });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch parcel stats' }));
    }

    const db = getDb();
    let list = (db.get('parcels').value() || []).filter(p => p.society_id === societyId);
    if (req.user.role === 'RESIDENT' && req.user.flat_number) {
      list = list.filter(p => p.flat_number === req.user.flat_number);
    }
    const today = new Date().toISOString().split('T')[0];
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const at_gate = list.filter(p => p.status === 'AT_GATE').length;
    const collected_today = list.filter(p => p.status === 'COLLECTED' && p.collected_at && p.collected_at.startsWith(today)).length;
    const overdue = list.filter(p => p.status === 'AT_GATE' && new Date(p.created_at) < twoDaysAgo).length;

    return res.json({ stats: { at_gate, collected_today, overdue } });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch parcel stats' });
  }
};
