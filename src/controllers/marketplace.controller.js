const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled } = require('../config/postgres');

const ensureMarketplaceTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS marketplace_items (
      id TEXT PRIMARY KEY,
      society_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      seller_name TEXT NOT NULL,
      seller_flat TEXT NOT NULL,
      seller_wing TEXT NOT NULL,
      seller_phone TEXT,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      listing_type TEXT DEFAULT 'SELL',
      price NUMERIC DEFAULT 0,
      original_price NUMERIC,
      condition TEXT DEFAULT 'GOOD',
      photos JSONB DEFAULT '[]'::jsonb,
      status TEXT DEFAULT 'AVAILABLE',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getAll = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) return res.status(400).json({ error: 'Society ID missing' });

    const { category, listing_type, status, search, mine } = req.query;

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureMarketplaceTable(client);
        let query = 'SELECT * FROM marketplace_items WHERE society_id = $1';
        let params = [societyId];

        if (mine === 'true') {
          params.push(req.user.id);
          query += ` AND seller_id = $${params.length}`;
        } else if (status) {
          params.push(status);
          query += ` AND status = $${params.length}`;
        }

        if (category && category !== 'ALL') {
          params.push(category);
          query += ` AND category = $${params.length}`;
        }

        if (listing_type && listing_type !== 'ALL') {
          params.push(listing_type);
          query += ` AND listing_type = $${params.length}`;
        }

        if (search) {
          params.push(`%${search.toLowerCase()}%`);
          query += ` AND (LOWER(title) LIKE $${params.length} OR LOWER(description) LIKE $${params.length})`;
        }

        query += ' ORDER BY created_at DESC';
        const r = await client.query(query, params);
        return res.json({ items: r.rows });
      }).catch((err) => {
        console.error('Fetch marketplace items error:', err);
        return res.status(500).json({ error: 'Failed to fetch items' });
      });
    }

    const db = getDb();
    let items = (db.get('marketplace_items').value() || []).filter(i => i.society_id === societyId);

    if (mine === 'true') {
      items = items.filter(i => i.seller_id === req.user.id);
    } else if (status) {
      items = items.filter(i => i.status === status);
    }

    if (category && category !== 'ALL') {
      items = items.filter(i => i.category === category);
    }

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(i => i.title.toLowerCase().includes(q) || (i.description && i.description.toLowerCase().includes(q)));
    }

    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return res.json({ items });
  } catch (error) {
    console.error('getAll marketplace catch error:', error);
    return res.status(500).json({ error: 'Failed to fetch items' });
  }
};

exports.getById = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const { id } = req.params;

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureMarketplaceTable(client);
        const r = await client.query('SELECT * FROM marketplace_items WHERE id = $1 AND society_id = $2', [id, societyId]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Item not found' });
        return res.json({ item: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch item' }));
    }

    const db = getDb();
    const item = (db.get('marketplace_items').value() || []).find(i => i.id === id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    return res.json({ item });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch item' });
  }
};

exports.create = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) return res.status(400).json({ error: 'Society ID missing' });

    const {
      title,
      description = '',
      category = 'OTHER',
      listing_type = 'SELL',
      price = 0,
      original_price = null,
      condition = 'GOOD',
      photos = [],
      seller_phone = req.user.phone || ''
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Listing title is required' });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const seller_name = `${req.user.first_name} ${req.user.last_name || ''}`.trim() || 'Resident';
    const seller_flat = req.user.flat_number || 'N/A';
    const seller_wing = req.user.wing || '';

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureMarketplaceTable(client);
        const q = `
          INSERT INTO marketplace_items (
            id, society_id, seller_id, seller_name, seller_flat, seller_wing,
            seller_phone, title, description, category, listing_type, price,
            original_price, condition, photos, status, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'AVAILABLE', $16, $16
          ) RETURNING *
        `;
        const r = await client.query(q, [
          id, societyId, req.user.id, seller_name, seller_flat, seller_wing,
          seller_phone, title, description, category, listing_type,
          parseFloat(price) || 0, original_price ? parseFloat(original_price) : null,
          condition, JSON.stringify(photos), now
        ]);

        return res.status(201).json({ message: 'Item listed successfully on society marketplace', item: r.rows[0] });
      }).catch((err) => {
        console.error('Create marketplace item error:', err);
        return res.status(500).json({ error: 'Failed to create listing' });
      });
    }

    const db = getDb();
    const newItem = {
      id,
      society_id: societyId,
      seller_id: req.user.id,
      seller_name,
      seller_flat,
      seller_wing,
      seller_phone,
      title,
      description,
      category,
      listing_type,
      price: parseFloat(price) || 0,
      original_price: original_price ? parseFloat(original_price) : null,
      condition,
      photos,
      status: 'AVAILABLE',
      created_at: now,
      updated_at: now
    };
    const list = db.get('marketplace_items').value() || [];
    list.unshift(newItem);
    db.set('marketplace_items', list).write();
    return res.status(201).json({ message: 'Item listed successfully on society marketplace', item: newItem });
  } catch (error) {
    console.error('Create marketplace catch error:', error);
    return res.status(500).json({ error: 'Failed to create listing' });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const { id } = req.params;
    const { status } = req.body;

    if (!['AVAILABLE', 'RESERVED', 'SOLD'].includes(status)) {
      return res.status(400).json({ error: 'Status must be AVAILABLE, RESERVED, or SOLD' });
    }

    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureMarketplaceTable(client);
        let q = 'UPDATE marketplace_items SET status = $1, updated_at = $2 WHERE id = $3 AND society_id = $4';
        let params = [status, now, id, societyId];

        // Only seller or Admin can change status
        if (req.user.role === 'RESIDENT') {
          params.push(req.user.id);
          q += ` AND seller_id = $${params.length}`;
        }

        q += ' RETURNING *';
        const r = await client.query(q, params);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Item not found or not authorized' });
        return res.json({ message: `Item marked as ${status.toLowerCase()}`, item: r.rows[0] });
      }).catch((err) => {
        console.error('updateStatus item error:', err);
        return res.status(500).json({ error: 'Failed to update item status' });
      });
    }

    const db = getDb();
    const list = db.get('marketplace_items').value() || [];
    const item = list.find(i => i.id === id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (req.user.role === 'RESIDENT' && item.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to edit this listing' });
    }

    item.status = status;
    item.updated_at = now;
    db.set('marketplace_items', list).write();
    return res.json({ message: `Item marked as ${status.toLowerCase()}`, item });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update item' });
  }
};

exports.deleteListing = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const { id } = req.params;

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureMarketplaceTable(client);
        let q = 'DELETE FROM marketplace_items WHERE id = $1 AND society_id = $2';
        let params = [id, societyId];

        if (req.user.role === 'RESIDENT') {
          params.push(req.user.id);
          q += ` AND seller_id = $${params.length}`;
        }

        const r = await client.query(q, params);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Item not found or not authorized' });
        return res.json({ message: 'Listing deleted successfully' });
      }).catch((err) => {
        console.error('Delete item error:', err);
        return res.status(500).json({ error: 'Failed to delete listing' });
      });
    }

    const db = getDb();
    let list = db.get('marketplace_items').value() || [];
    const item = list.find(i => i.id === id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (req.user.role === 'RESIDENT' && item.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this listing' });
    }

    list = list.filter(i => i.id !== id);
    db.set('marketplace_items', list).write();
    return res.json({ message: 'Listing deleted successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete listing' });
  }
};
