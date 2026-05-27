const { pool, getTenantSchemaName } = require('../config/postgres');
const { v4: uuidv4 } = require('uuid');
const { logAudit } = require('./audit.controller');

const getActivePermissions = async (req, res) => {
  try {
    const societyId = req.query.societyId || req.user.society_id;
    if (!societyId) {
      return res.status(400).json({ error: 'societyId is required' });
    }

    const schema = getTenantSchemaName(societyId);
    
    // Check for PLATFORM_ADMIN
    if (req.user.role === 'PLATFORM_ADMIN' || req.user.role === 'ADMIN') {
      const allPerms = await pool.query(`SELECT code FROM "${schema}".permissions`);
      return res.json({ permissions: allPerms.rows.map(p => p.code) });
    }

    const query = `
      SELECT DISTINCT p.code 
      FROM "${schema}".society_position_assignments spa
      JOIN "${schema}".position_roles pr ON spa.position_id = pr.position_id
      JOIN "${schema}".role_permissions rp ON pr.role_id = rp.role_id
      JOIN "${schema}".permissions p ON rp.permission_id = p.id
      WHERE spa.user_id = $1 
        AND spa.status = 'ACTIVE' 
        AND CURRENT_DATE BETWEEN spa.start_date AND spa.end_date
    `;
    
    const result = await pool.query(query, [req.user.id]);
    const permissions = result.rows.map(r => r.code);
    
    res.json({ permissions });
  } catch (err) {
    console.error('Error fetching permissions:', err);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
};

const assignPosition = async (req, res) => {
  const { societyId } = req.params;
  const { userId, positionCode, startDate, endDate } = req.body;

  if (!userId || !positionCode || !startDate || !endDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const schema = getTenantSchemaName(societyId);
    
    // Find position ID
    const posResult = await pool.query(`SELECT id FROM "${schema}".position_master WHERE code = $1`, [positionCode]);
    if (posResult.rows.length === 0) {
      return res.status(404).json({ error: 'Position not found' });
    }
    const positionId = posResult.rows[0].id;

    // Check for overlapping assignments
    const overlapCheck = await pool.query(`
      SELECT id FROM "${schema}".society_position_assignments 
      WHERE user_id = $1 
        AND position_id = $2
        AND status = 'ACTIVE'
        AND (
          (start_date <= $3 AND end_date >= $3) OR
          (start_date <= $4 AND end_date >= $4) OR
          (start_date >= $3 AND end_date <= $4)
        )
    `, [userId, positionId, startDate, endDate]);

    if (overlapCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Overlapping active assignment exists for this position' });
    }

    const id = uuidv4();
    await pool.query(`
      INSERT INTO "${schema}".society_position_assignments
      (id, user_id, position_id, start_date, end_date, status)
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
    `, [id, userId, positionId, startDate, endDate]);

    // Audit log
    await logAudit(
      req,
      'ASSIGN_POSITION',
      'POSITION_ASSIGNMENT',
      id,
      null,
      { userId, positionCode, startDate, endDate }
    );

    res.status(201).json({ message: 'Position assigned successfully', assignmentId: id });
  } catch (err) {
    console.error('Error assigning position:', err);
    res.status(500).json({ error: 'Failed to assign position' });
  }
};

const getPositions = async (req, res) => {
  const { societyId } = req.params;
  try {
    const schema = getTenantSchemaName(societyId);
    const result = await pool.query(`SELECT * FROM "${schema}".position_master ORDER BY hierarchy_order ASC`);
    res.json({ positions: result.rows });
  } catch (err) {
    console.error('Error fetching positions:', err);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
};

const getAssignments = async (req, res) => {
  const { societyId } = req.params;
  try {
    const schema = getTenantSchemaName(societyId);
    const result = await pool.query(`
      SELECT spa.*, p.name as position_name, u.first_name, u.last_name, u.email
      FROM "${schema}".society_position_assignments spa
      JOIN "${schema}".position_master p ON spa.position_id = p.id
      JOIN platform.users u ON spa.user_id = u.id
      ORDER BY spa.start_date DESC
    `);
    res.json({ assignments: result.rows });
  } catch (err) {
    console.error('Error fetching assignments:', err);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
};

module.exports = {
  getActivePermissions,
  assignPosition,
  getPositions,
  getAssignments
};
