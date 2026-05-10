const { v4: uuidv4 } = require('uuid');
const { pool, isPostgresEnabled, withTenant } = require('../config/postgres');
const { isPlatformRole } = require('../constants/roles');

const LISTING_TYPES = { FOR_SALE: 'FOR_SALE', ON_RENT: 'ON_RENT' };
const LISTING_STATUS = { PENDING: 'PENDING_PAYMENT', PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED', PENDING_APPROVAL: 'PENDING_APPROVAL', APPROVED: 'APPROVED', REJECTED: 'REJECTED', ACTIVE: 'ACTIVE', EXPIRED: 'EXPIRED', SOLD: 'SOLD', RENTED: 'RENTED', CLOSED: 'CLOSED' };
const LISTING_FEES = { FOR_SALE: 99, ON_RENT: 49 }; // GST at 18%

// ─── Society: Create Property Listing ─────────────────────────────────
exports.createListing = async (req, res) => {
  try {
    const { listing_type, flat_number, wing, floor, carpet_area, super_builtup_area, bedrooms, bathrooms, parking, price, rent_amount, furnishing, available_from, description, contact_name, contact_phone, photos } = req.body;

    if (!listing_type || !flat_number || !wing || !price && !rent_amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const listingId = uuidv4();
    const now = new Date().toISOString();
    const duration_days = 30; // default
    const expires_at = new Date(Date.now() + duration_days * 86400000).toISOString();

    const listing = {
      id: listingId, society_id: req.user.society_id, listing_type,
      flat_number, wing, floor: floor || null, carpet_area: carpet_area || null,
      super_builtup_area: super_builtup_area || null, bedrooms: bedrooms || null,
      bathrooms: bathrooms || null, parking: parking || null,
      price: price || null, rent_amount: rent_amount || null,
      furnishing: furnishing || 'UNFURNISHED', available_from: available_from || null,
      description: description || null, contact_name: contact_name || null,
      contact_phone: contact_phone || null, photos: photos || [],
      status: LISTING_STATUS.PENDING, created_by: req.user.id,
      fee_amount: LISTING_FEES[listing_type] || 0,
      expires_at, duration_days,
      created_at: now, updated_at: now
    };

    if (isPostgresEnabled && req.user.society_id) {
      await withTenant(req.user.society_id, async (client) => {
        await client.query(`
          CREATE TABLE IF NOT EXISTS property_listings (
            id TEXT PRIMARY KEY, society_id TEXT, listing_type TEXT,
            flat_number TEXT, wing TEXT, floor INTEGER, carpet_area NUMERIC,
            super_builtup_area NUMERIC, bedrooms INTEGER, bathrooms INTEGER,
            parking INTEGER, price NUMERIC, rent_amount NUMERIC,
            furnishing TEXT, available_from DATE, description TEXT,
            contact_name TEXT, contact_phone TEXT, photos JSONB DEFAULT '[]',
            status TEXT DEFAULT 'PENDING_PAYMENT', created_by TEXT,
            fee_amount NUMERIC DEFAULT 0, paid_amount NUMERIC DEFAULT 0,
            approved_by TEXT, approved_at TIMESTAMPTZ, rejection_reason TEXT,
            expires_at TIMESTAMPTZ, duration_days INTEGER DEFAULT 30,
            created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);

        await client.query(`
          INSERT INTO property_listings
            (id,society_id,listing_type,flat_number,wing,floor,carpet_area,super_builtup_area,bedrooms,bathrooms,parking,price,rent_amount,furnishing,available_from,description,contact_name,contact_phone,photos,status,created_by,fee_amount,expires_at,duration_days,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
        `, [listing.id, listing.society_id, listing.listing_type, listing.flat_number, listing.wing, listing.floor, listing.carpet_area, listing.super_builtup_area, listing.bedrooms, listing.bathrooms, listing.parking, listing.price, listing.rent_amount, listing.furnishing, listing.available_from, listing.description, listing.contact_name, listing.contact_phone, JSON.stringify(listing.photos), listing.status, listing.created_by, listing.fee_amount, listing.expires_at, listing.duration_days, listing.created_at, listing.updated_at]);
      });
    }

    // TODO: Collect payment via gateway here
    // For MVP, auto-confirm payment
    await withTenant(req.user.society_id, async (client) => {
      await client.query('UPDATE property_listings SET status = $1, paid_amount = fee_amount, updated_at = NOW() WHERE id = $2', [LISTING_STATUS.PENDING_APPROVAL, listingId]);
    });

    res.status(201).json({ listing: { ...listing, status: LISTING_STATUS.PENDING_APPROVAL }, message: 'Payment confirmed. Listing submitted for approval.' });
  } catch (error) {
    console.error('Create listing error:', error);
    res.status(500).json({ error: 'Failed to create listing' });
  }
};

// ─── Society Admin: Approve Listing ─────────────────────────────────────
exports.approveListing = async (req, res) => {
  try {
    if (!['ADMIN', 'TREASURER'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin or Treasurer access required' });
    }

    const { listing_id, comment } = req.body;

    await withTenant(req.user.society_id, async (client) => {
      await client.query(
        'UPDATE property_listings SET status = $1, approved_by = $2, approved_at = NOW(), rejection_reason = $3, updated_at = NOW() WHERE id = $4',
        [LISTING_STATUS.APPROVED, req.user.id, comment || null, listing_id]
      );
    });

    res.json({ message: 'Listing approved and published.' });
  } catch (error) {
    console.error('Approve listing error:', error);
    res.status(500).json({ error: 'Failed to approve listing' });
  }
};

// ─── Society Admin: Reject Listing ─────────────────────────────────────
exports.rejectListing = async (req, res) => {
  try {
    if (!['ADMIN', 'TREASURER'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin or Treasurer access required' });
    }

    const { listing_id, reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Rejection reason is mandatory' });

    await withTenant(req.user.society_id, async (client) => {
      await client.query(
        'UPDATE property_listings SET status = $1, rejection_reason = $2, updated_at = NOW() WHERE id = $3',
        [LISTING_STATUS.REJECTED, reason, listing_id]
      );
    });

    // TODO: Initiate refund within 5 business days

    res.json({ message: 'Listing rejected. Refund will be processed.' });
  } catch (error) {
    console.error('Reject listing error:', error);
    res.status(500).json({ error: 'Failed to reject listing' });
  }
};

// ─── Get Listings (Public to society members) ──────────────────────────
exports.getListings = async (req, res) => {
  try {
    const { status, type, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    await withTenant(req.user.society_id, async (client) => {
      let where = ['(status = $1 OR status = $2)'];
      let params = [LISTING_STATUS.APPROVED, LISTING_STATUS.ACTIVE];
      let idx = 3;

      if (status && ['SOLD', 'RENTED', 'EXPIRED', 'CLOSED'].includes(status)) {
        where = ['status = $1'];
        params = [status]; idx = 2;
      }
      if (type) { where.push(`listing_type = $${idx++}`); params.push(type); }

      const result = await client.query(`
        SELECT id, listing_type, flat_number, wing, floor, carpet_area, super_builtup_area,
               bedrooms, bathrooms, parking, price, rent_amount, furnishing,
               available_from, description, photos, status, expires_at, created_at
        FROM property_listings
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${idx++} OFFSET $${idx}
      `, [...params, parseInt(limit), offset]);

      // Mask contact details for non-owners
      const listings = result.rows.map(l => {
        if (l.created_by !== req.user.id && !['ADMIN', 'TREASURER'].includes(req.user.role)) {
          delete l.contact_name; delete l.contact_phone;
        }
        return l;
      });

      res.json({ listings, page: parseInt(page), limit: parseInt(limit) });
    });
  } catch (error) {
    console.error('Get listings error:', error);
    res.status(500).json({ error: 'Failed to fetch listings' });
  }
};

// ─── Owner: Mark as Sold/Rented ─────────────────────────────────────────
exports.closeListing = async (req, res) => {
  try {
    const { listing_id, closure_type } = req.body;
    const newStatus = closure_type === 'SOLD' ? LISTING_STATUS.SOLD : LISTING_STATUS.RENTED;

    await withTenant(req.user.society_id, async (client) => {
      const r = await client.query('SELECT created_by FROM property_listings WHERE id = $1', [listing_id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Listing not found' });
      if (r.rows[0].created_by !== req.user.id && !['ADMIN', 'TREASURER'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Not authorized' });
      }

      await client.query('UPDATE property_listings SET status = $1, updated_at = NOW() WHERE id = $2', [newStatus, listing_id]);
    });

    res.json({ message: `Listing marked as ${closure_type.toLowerCase()}.` });
  } catch (error) {
    console.error('Close listing error:', error);
    res.status(500).json({ error: 'Failed to close listing' });
  }
};

// ─── Owner: Renew Listing ──────────────────────────────────────────────
exports.renewListing = async (req, res) => {
  try {
    const { listing_id } = req.body;
    const newExpiry = new Date(Date.now() + 30 * 86400000).toISOString();

    await withTenant(req.user.society_id, async (client) => {
      const r = await client.query('SELECT created_by FROM property_listings WHERE id = $1', [listing_id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Listing not found' });
      if (r.rows[0].created_by !== req.user.id && !['ADMIN', 'TREASURER'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Not authorized' });
      }

      // TODO: Collect renewal fee
      await client.query(
        'UPDATE property_listings SET status = $1, expires_at = $2, updated_at = NOW() WHERE id = $3',
        [LISTING_STATUS.ACTIVE, newExpiry, listing_id]
      );
    });

    res.json({ message: 'Listing renewed for 30 days.', expires_at: newExpiry });
  } catch (error) {
    console.error('Renew listing error:', error);
    res.status(500).json({ error: 'Failed to renew listing' });
  }
};

// ─── Admin: Get Approval Queue ─────────────────────────────────────────
exports.getApprovalQueue = async (req, res) => {
  try {
    if (!['ADMIN', 'TREASURER'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin or Treasurer access required' });
    }

    await withTenant(req.user.society_id, async (client) => {
      const result = await client.query(`
        SELECT pl.*, u.first_name, u.last_name
        FROM property_listings pl
        LEFT JOIN platform.users u ON u.id = pl.created_by
        WHERE pl.status IN ($1, $2)
        ORDER BY pl.created_at ASC
      `, [LISTING_STATUS.PENDING_APPROVAL, LISTING_STATUS.PAYMENT_CONFIRMED]);

      res.json({ listings: result.rows });
    });
  } catch (error) {
    console.error('Get approval queue error:', error);
    res.status(500).json({ error: 'Failed to fetch approval queue' });
  }
};

// ─── Platform: Revenue Report ─────────────────────────────────────────
exports.getPlatformRevenue = async (req, res) => {
  try {
    if (!isPlatformRole(req.user.role)) {
      return res.status(403).json({ error: 'Platform admin access required' });
    }

    const { from, to, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = [];
    let params = [];
    let idx = 1;

    if (from) { where.push(`pl.created_at >= $${idx++}`); params.push(from); }
    if (to) { where.push(`pl.created_at <= $${idx++}`); params.push(to); }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const result = await pool.query(`
      SELECT s.id as society_id, s.name as society_name, pl.listing_type,
             COUNT(*) as listing_count, SUM(pl.fee_amount) as total_fees,
             SUM(pl.fee_amount * 0.18) as gst_collected, SUM(pl.fee_amount * 1.18) as gross_amount
      FROM platform.societies s
      CROSS JOIN LATERAL (
        SELECT listing_type, fee_amount, created_at
        FROM "society_${s.id.replace(/-/g, '_')}".property_listings
        WHERE status NOT IN ('REJECTED', 'PENDING_PAYMENT')
      ) pl
      ${whereClause}
      GROUP BY s.id, s.name, pl.listing_type
      ORDER BY total_fees DESC
      LIMIT $${idx++} OFFSET $${idx}
    `, [...params, parseInt(limit), offset]);

    res.json({ revenue: result.rows });
  } catch (error) {
    console.error('Platform revenue error:', error);
    res.status(500).json({ error: 'Failed to fetch revenue report' });
  }
};

// ─── Toggle Listing Visibility (Public/Private) ─────────────────────
exports.toggleVisibility = async (req, res) => {
  try {
    const { id } = req.params;
    const { visibility } = req.body;
    const role = req.user.role;
    if (!['ADMIN', 'TREASURER'].includes(role) && !isPlatformRole(role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    await withTenant(req.user.society_id, async (client) => {
      await client.query(`
        ALTER TABLE property_listings ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'PUBLIC'
      `);
      await client.query(
        'UPDATE property_listings SET visibility = $1, updated_at = NOW() WHERE id = $2',
        [visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC', id]
      );
    });

    const { logAudit } = require('./audit.controller');
    await logAudit(req, 'LISTING_VISIBILITY_CHANGED', 'PROPERTY_LISTING', id, null, { visibility });
    res.json({ message: `Listing visibility set to ${visibility}` });
  } catch (error) {
    console.error('Toggle visibility error:', error);
    res.status(500).json({ error: 'Failed to toggle visibility' });
  }
};

// ─── Society-Level Revenue Report ────────────────────────────────────
exports.getSocietyRevenue = async (req, res) => {
  try {
    const role = req.user.role;
    if (!['ADMIN', 'TREASURER'].includes(role) && !isPlatformRole(role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { from, to } = req.query;

    await withTenant(req.user.society_id, async (client) => {
      let q = `
        SELECT listing_type, status, COUNT(*) as count,
               COALESCE(SUM(fee_amount), 0) as total_fees,
               COALESCE(SUM(fee_amount * 0.18), 0) as gst_collected
        FROM property_listings
        WHERE 1=1
      `;
      const params = [];
      let idx = 1;
      if (from) { q += ` AND created_at >= $${idx++}`; params.push(from); }
      if (to) { q += ` AND created_at <= $${idx++}`; params.push(to); }
      q += ' GROUP BY listing_type, status ORDER BY total_fees DESC';

      const result = await client.query(q, params);
      return res.json({ revenue: result.rows });
    });
  } catch (error) {
    console.error('Society revenue error:', error);
    res.status(500).json({ error: 'Failed to fetch society revenue' });
  }
};

exports.LISTING_TYPES = LISTING_TYPES;
exports.LISTING_STATUS = LISTING_STATUS;
exports.LISTING_FEES = LISTING_FEES;