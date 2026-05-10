const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, ensurePlatformSchema } = require('../config/postgres');

const DOC_CATEGORIES = ['AGREEMENT', 'RECEIPT', 'COMPLIANCE', 'MAINTENANCE', 'INSURANCE', 'PERMIT', 'OTHER'];

const ensureDocumentTables = async (societyId) => {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS \"society_${societyId}\"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \"society_${societyId}\".documents (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      title TEXT,
      description TEXT,
      category TEXT DEFAULT 'OTHER',
      flat_id TEXT,
      file_name TEXT,
      file_path TEXT,
      file_size INTEGER,
      file_type TEXT,
      uploaded_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getAll = (req, res) => {
  try {
    const { category, search } = req.query;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensurePlatformSchema().then(async () => {
        let query = `SELECT * FROM \"society_${societyId}\".documents WHERE 1=1`;
        const params = [];
        let idx = 1;

        if (category) { query += ` AND category = $${idx++}`; params.push(category); }
        if (search) { query += ` AND (title ILIKE $${idx} OR description ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

        query += ' ORDER BY created_at DESC';
        const r = await pool.query(query, params);
        return res.json({ documents: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch documents' }));
    }

    const db = getDb();
    let docs = db.get('documents').filter(d => d.society_id === societyId).value();

    if (category) docs = docs.filter(d => d.category === category);
    if (search) {
      const s = search.toLowerCase();
      docs = docs.filter(d => d.title.toLowerCase().includes(s) || (d.description && d.description.toLowerCase().includes(s)));
    }

    res.json({ documents: docs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
};

exports.getById = (req, res) => {
  try {
    const { id } = req.params;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureDocumentTables(societyId).then(async () => {
        const r = await pool.query(`SELECT * FROM \"society_${societyId}\".documents WHERE id = $1`, [id]);
        if (!r.rows[0]) return res.status(404).json({ error: 'Document not found' });
        return res.json({ document: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch document' }));
    }

    const db = getDb();
    const doc = db.get('documents').find({ id, society_id: societyId }).value();
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json({ document: doc });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch document' });
  }
};

exports.upload = (req, res) => {
  try {
    const { title, description, category, flat_id } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const docData = {
      id: uuidv4(),
      society_id: societyId,
      title,
      description,
      category: category || 'OTHER',
      flat_id: flat_id || null,
      file_name: req.file.originalname,
      file_path: `/uploads/${req.file.filename}`,
      file_size: req.file.size,
      file_type: req.file.mimetype,
      uploaded_by: req.user.id,
      created_at: now,
      updated_at: now
    };

    if (isPostgresEnabled) {
      return ensureDocumentTables(societyId).then(async () => {
        await pool.query(
          `INSERT INTO \"society_${societyId}\".documents (id, society_id, title, description, category, flat_id, file_name, file_path, file_size, file_type, uploaded_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [docData.id, docData.society_id, docData.title, docData.description, docData.category, docData.flat_id, docData.file_name, docData.file_path, docData.file_size, docData.file_type, docData.uploaded_by, docData.created_at]
        );
        return res.status(201).json({ document: docData });
      }).catch(() => res.status(500).json({ error: 'Failed to upload document' }));
    }

    const db = getDb();
    if (!db.get('documents').value()) db.set('documents', []).write();
    db.get('documents').push(docData).write();
    res.status(201).json({ document: docData });
  } catch (error) {
    res.status(500).json({ error: 'Failed to upload document' });
  }
};

exports.update = (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, flat_id } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      return ensureDocumentTables(societyId).then(async () => {
        await pool.query(
          `UPDATE \"society_${societyId}\".documents SET title = COALESCE($1, title), description = COALESCE($2, description), category = COALESCE($3, category), flat_id = COALESCE($4, flat_id), updated_at = $5 WHERE id = $6`,
          [title, description, category, flat_id, now, id]
        );
        const r = await pool.query(`SELECT * FROM \"society_${societyId}\".documents WHERE id = $1`, [id]);
        return res.json({ document: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to update document' }));
    }

    const db = getDb();
    const updates = {};
    if (title) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (category) updates.category = category;
    if (flat_id !== undefined) updates.flat_id = flat_id;
    updates.updated_at = now;

    db.get('documents').find({ id, society_id: societyId }).assign(updates).write();
    res.json({ document: db.get('documents').find({ id }).value() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update document' });
  }
};

exports.delete = (req, res) => {
  try {
    const { id } = req.params;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureDocumentTables(societyId).then(async () => {
        await pool.query(`DELETE FROM \"society_${societyId}\".documents WHERE id = $1`, [id]);
        return res.json({ message: 'Document deleted' });
      }).catch(() => res.status(500).json({ error: 'Failed to delete document' }));
    }

    const db = getDb();
    db.get('documents').remove({ id, society_id: societyId }).write();
    res.json({ message: 'Document deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete document' });
  }
};

exports.getCategories = (req, res) => {
  res.json({ categories: DOC_CATEGORIES });
};