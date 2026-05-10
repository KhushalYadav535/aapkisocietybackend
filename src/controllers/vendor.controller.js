const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, ensurePlatformSchema } = require('../config/postgres');

const ensureVendorTables = async (societyId) => {
  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS \"society_${societyId}\"`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \"society_${societyId}\".vendors (
        id TEXT PRIMARY KEY,
        society_id TEXT,
        name TEXT,
        category TEXT,
        contact_person TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        services TEXT,
        hourly_rate NUMERIC DEFAULT 0,
        rating NUMERIC DEFAULT 0,
        total_ratings INTEGER DEFAULT 0,
        is_verified BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \"society_${societyId}\".vendor_reviews (
        id TEXT PRIMARY KEY,
        vendor_id TEXT,
        user_id TEXT,
        rating INTEGER,
        review TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (err) {
    if (err.message && err.message.includes('already exists')) {
      return;
    }
    throw err;
  }
};

exports.getAll = (req, res) => {
  try {
    const { category, search, rating } = req.query;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureVendorTables(societyId).then(async () => {
        let query = `SELECT * FROM \"society_${societyId}\".vendors WHERE society_id = $1`;
        const params = [societyId];
        let idx = 2;

        if (category) { query += ` AND category = $${idx++}`; params.push(category); }
        if (rating) { query += ` AND rating >= $${idx++}`; params.push(parseFloat(rating)); }
        if (search) {
          query += ` AND (name ILIKE $${idx} OR description ILIKE $${idx} OR services ILIKE $${idx})`;
          params.push(`%${search}%`); idx++;
        }
        query += ' ORDER BY rating DESC, name ASC';

        const r = await pool.query(query, params);
        return res.json({ vendors: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch vendors' }));
    }

    const db = getDb();
    let vendors = db.get('vendors').filter(v => v.society_id === societyId).value();

    if (category) vendors = vendors.filter(v => v.category === category);
    if (rating) vendors = vendors.filter(v => (v.rating || 0) >= parseFloat(rating));
    if (search) {
      const s = search.toLowerCase();
      vendors = vendors.filter(v =>
        v.name.toLowerCase().includes(s) ||
        (v.description && v.description.toLowerCase().includes(s)) ||
        (v.services && v.services.toLowerCase().includes(s))
      );
    }

    res.json({ vendors: vendors.sort((a, b) => (b.rating || 0) - (a.rating || 0)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch vendors' });
  }
};

exports.create = (req, res) => {
  try {
    const { name, category, contact_person, phone, email, address, services, hourly_rate, is_verified } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (!['ADMIN', 'COMMITTEE'].includes(req.user.role)) return res.status(403).json({ error: 'Not authorized' });

    const vendor = {
      id: uuidv4(), society_id: societyId, name, category,
      contact_person, phone, email, address,
      services: services || [], hourly_rate: hourly_rate || 0,
      rating: 0, total_ratings: 0,
      is_verified: is_verified || false,
      is_active: true,
      created_by: req.user.id,
      created_at: now, updated_at: now
    };

    if (isPostgresEnabled) {
      return ensureVendorTables(societyId).then(async () => {
        await pool.query(
          `INSERT INTO \"society_${societyId}\".vendors (id, society_id, name, category, contact_person, phone, email, address, services, hourly_rate, rating, total_ratings, is_verified, is_active, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [vendor.id, vendor.society_id, vendor.name, vendor.category, vendor.contact_person, vendor.phone, vendor.email, vendor.address, vendor.services, vendor.hourly_rate, vendor.rating, vendor.total_ratings, vendor.is_verified, vendor.is_active, vendor.created_by, vendor.created_at]
        );
        return res.status(201).json({ vendor });
      }).catch(() => res.status(500).json({ error: 'Failed to create vendor' }));
    }

    const db = getDb();
    if (!db.get('vendors').value()) db.set('vendors', []).write();
    db.get('vendors').push(vendor).write();
    res.status(201).json({ vendor });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create vendor' });
  }
};

exports.update = (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, contact_person, phone, email, address, services, hourly_rate, is_verified, is_active } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      return ensureVendorTables(societyId).then(async () => {
        const fields = [];
        const values = [];
        let idx = 1;

        if (name) { fields.push(`name = $${idx++}`); values.push(name); }
        if (category) { fields.push(`category = $${idx++}`); values.push(category); }
        if (contact_person !== undefined) { fields.push(`contact_person = $${idx++}`); values.push(contact_person); }
        if (phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(phone); }
        if (email !== undefined) { fields.push(`email = $${idx++}`); values.push(email); }
        if (address !== undefined) { fields.push(`address = $${idx++}`); values.push(address); }
        if (services !== undefined) { fields.push(`services = $${idx++}`); values.push(services); }
        if (hourly_rate !== undefined) { fields.push(`hourly_rate = $${idx++}`); values.push(hourly_rate); }
        if (is_verified !== undefined) { fields.push(`is_verified = $${idx++}`); values.push(is_verified); }
        if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(is_active); }
        fields.push(`updated_at = $${idx++}`); values.push(now);
        values.push(id);

        await pool.query(`UPDATE \"society_${societyId}\".vendors SET ${fields.join(', ')} WHERE id = $${idx}`, values);
        const r = await pool.query(`SELECT * FROM \"society_${societyId}\".vendors WHERE id = $1`, [id]);
        return res.json({ vendor: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to update vendor' }));
    }

    const db = getDb();
    const updates = {};
    if (name) updates.name = name;
    if (category) updates.category = category;
    if (contact_person !== undefined) updates.contact_person = contact_person;
    if (phone !== undefined) updates.phone = phone;
    if (email !== undefined) updates.email = email;
    if (address !== undefined) updates.address = address;
    if (services !== undefined) updates.services = services;
    if (hourly_rate !== undefined) updates.hourly_rate = hourly_rate;
    if (is_verified !== undefined) updates.is_verified = is_verified;
    if (is_active !== undefined) updates.is_active = is_active;
    updates.updated_at = now;

    db.get('vendors').find({ id }).assign(updates).write();
    res.json({ vendor: db.get('vendors').find({ id }).value() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update vendor' });
  }
};

exports.rate = (req, res) => {
  try {
    const { id } = req.params;
    const { rating, review } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });

    if (isPostgresEnabled) {
      return ensureVendorTables(societyId).then(async () => {
        const vendor = await pool.query(`SELECT * FROM \"society_${societyId}\".vendors WHERE id = $1`, [id]);
        if (!vendor.rows[0]) return res.status(404).json({ error: 'Vendor not found' });

        const currentRating = vendor.rows[0].rating || 0;
        const currentCount = vendor.rows[0].total_ratings || 0;
        const newCount = currentCount + 1;
        const newRating = ((currentRating * currentCount) + rating) / newCount;

        await pool.query(
          `UPDATE \"society_${societyId}\".vendors SET rating = $1, total_ratings = $2, updated_at = $3 WHERE id = $4`,
          [parseFloat(newRating.toFixed(1)), newCount, now, id]
        );

        await pool.query(
          `INSERT INTO \"society_${societyId}\".vendor_reviews (id, vendor_id, user_id, rating, review, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [uuidv4(), id, req.user.id, rating, review, now]
        );

        const updated = await pool.query(`SELECT * FROM \"society_${societyId}\".vendors WHERE id = $1`, [id]);
        return res.json({ vendor: updated.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to rate vendor' }));
    }

    const db = getDb();
    const vendor = db.get('vendors').find({ id }).value();
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    const currentRating = vendor.rating || 0;
    const currentCount = vendor.total_ratings || 0;
    const newCount = currentCount + 1;
    const newRating = ((currentRating * currentCount) + rating) / newCount;

    if (!db.get('vendor_reviews').value()) db.set('vendor_reviews', []).write();
    db.get('vendor_reviews').push({ id: uuidv4(), vendor_id: id, user_id: req.user.id, rating, review, created_at: now }).write();

    db.get('vendors').find({ id }).assign({
      rating: parseFloat(newRating.toFixed(1)),
      total_ratings: newCount,
      updated_at: now
    }).write();

    res.json({ vendor: db.get('vendors').find({ id }).value() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to rate vendor' });
  }
};

exports.getReviews = (req, res) => {
  try {
    const { id } = req.params;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureVendorTables(societyId).then(async () => {
        const r = await pool.query(`
          SELECT vr.*, u.first_name, u.last_name, u.flat_number, u.wing
          FROM \"society_${societyId}\".vendor_reviews vr
          JOIN platform.users u ON u.id = vr.user_id
          WHERE vr.vendor_id = $1
          ORDER BY vr.created_at DESC
        `, [id]);
        return res.json({ reviews: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch reviews' }));
    }

    const db = getDb();
    const reviews = db.get('vendor_reviews') ? db.get('vendor_reviews').filter(r => r.vendor_id === id).value() : [];
    const users = db.get('users').value();

    const withUser = reviews.map(r => {
      const user = users.find(u => u.id === r.user_id);
      return { ...r, first_name: user?.first_name, last_name: user?.last_name, flat_number: user?.flat_number, wing: user?.wing };
    });

    res.json({ reviews: withUser.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
};

exports.delete = (req, res) => {
  try {
    const { id } = req.params;
    const societyId = req.user.society_id;

    if (!['ADMIN', 'COMMITTEE'].includes(req.user.role)) return res.status(403).json({ error: 'Not authorized' });

    if (isPostgresEnabled) {
      return ensureVendorTables(societyId).then(async () => {
        await pool.query(`DELETE FROM \"society_${societyId}\".vendors WHERE id = $1`, [id]);
        return res.json({ message: 'Vendor removed' });
      }).catch(() => res.status(500).json({ error: 'Failed to remove vendor' }));
    }

    const db = getDb();
    db.get('vendors').remove({ id }).write();
    res.json({ message: 'Vendor removed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove vendor' });
  }
};

exports.getCategories = (req, res) => {
  const categories = ['PLUMBER', 'ELECTRICIAN', 'CARPENTER', 'PAINTER', 'CLEANING', 'PEST_CONTROL', 'GARDENER', 'SECURITY', 'MOVING', 'AC_REPAIR', 'APPLIANCE', 'GENERAL'];
  res.json({ categories });
};