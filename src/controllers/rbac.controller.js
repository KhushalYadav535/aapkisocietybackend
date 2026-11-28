const { pool, getTenantSchemaName, isPostgresEnabled } = require('../config/postgres');
const { v4: uuidv4 } = require('uuid');
const { logAudit } = require('./audit.controller');

const getActivePermissions = async (req, res) => {
  try {
    const role = (req.user?.role || '').toUpperCase();

    if (!isPostgresEnabled) {
      let permissions = [];
      if (['ADMIN', 'PLATFORM_ADMIN'].includes(role)) {
        permissions = ['*'];
      } else if (['COMMITTEE', 'SECRETARY'].includes(role)) {
        permissions = ['COMPLAINT_ASSIGN', 'COMPLAINT_RESOLVE', 'NOC_MANAGE', 'NOC_APPROVE', 'VIOLATION_MANAGE', 'ACCOUNTING_MANAGE', 'AUDIT_VIEW', 'VOUCHER_VIEW', 'REPORT_VIEW', 'COMPLIANCE_MANAGE', 'NOTIFICATION_MANAGE', 'NOTICE_CREATE'];
      } else if (['TREASURER', 'TREASURY'].includes(role)) {
        permissions = ['ACCOUNTING_MANAGE', 'AUDIT_VIEW', 'VOUCHER_VIEW', 'REPORT_VIEW', 'BILLING_APPROVE', 'BILL_APPROVE', 'BILLING_CREATE', 'COMPLIANCE_MANAGE', 'NOTIFICATION_MANAGE', 'TAX_MANAGE', 'TAX_VIEW'];
      } else if (['CHECKER', 'TREASURY_CHECKER'].includes(role)) {
        permissions = ['ACCOUNTING_MANAGE', 'AUDIT_VIEW', 'VOUCHER_VIEW', 'REPORT_VIEW', 'BILLING_APPROVE', 'BILL_APPROVE', 'COMPLIANCE_MANAGE', 'TAX_MANAGE', 'TAX_VIEW', 'NOTIFICATION_MANAGE'];
      } else if (['MAKER', 'TREASURY_MAKER'].includes(role)) {
        permissions = ['ACCOUNTING_MANAGE', 'AUDIT_VIEW', 'VOUCHER_VIEW', 'REPORT_VIEW', 'BILLING_CREATE', 'COMPLIANCE_MANAGE'];
      } else if (role === 'GUARD') {
        permissions = ['VISITOR_MANAGE', 'PATROL_MANAGE', 'SOS_RESPOND'];
      }
      return res.json({ permissions });
    }

    const societyId = req.query.societyId || req.user.society_id;
    if (!societyId) {
      if (req.user.role === 'PLATFORM_ADMIN') {
        return res.json({ permissions: ['*'] });
      }
      return res.json({ permissions: [] });
    }

    const schema = getTenantSchemaName(societyId);
    
    // Check for PLATFORM_ADMIN or ADMIN
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
    
    let permissions = [];
    try {
      const result = await pool.query(query, [req.user.id]);
      permissions = result.rows.map(r => r.code);
    } catch (_) {}

    if (['COMMITTEE', 'SECRETARY'].includes(role)) {
      const perms = ['COMPLAINT_ASSIGN', 'COMPLAINT_RESOLVE', 'NOC_MANAGE', 'NOC_APPROVE', 'VIOLATION_MANAGE', 'ACCOUNTING_MANAGE', 'AUDIT_VIEW', 'VOUCHER_VIEW', 'REPORT_VIEW', 'COMPLIANCE_MANAGE', 'NOTIFICATION_MANAGE', 'NOTICE_CREATE'];
      permissions = Array.from(new Set([...permissions, ...perms]));
    } else if (['TREASURER', 'TREASURY'].includes(role)) {
      const perms = ['ACCOUNTING_MANAGE', 'AUDIT_VIEW', 'VOUCHER_VIEW', 'REPORT_VIEW', 'BILLING_APPROVE', 'BILL_APPROVE', 'BILLING_CREATE', 'COMPLIANCE_MANAGE', 'NOTIFICATION_MANAGE', 'TAX_MANAGE', 'TAX_VIEW'];
      permissions = Array.from(new Set([...permissions, ...perms]));
    } else if (['CHECKER', 'TREASURY_CHECKER'].includes(role)) {
      const perms = ['ACCOUNTING_MANAGE', 'AUDIT_VIEW', 'VOUCHER_VIEW', 'REPORT_VIEW', 'BILLING_APPROVE', 'BILL_APPROVE', 'COMPLIANCE_MANAGE', 'TAX_MANAGE', 'TAX_VIEW', 'NOTIFICATION_MANAGE'];
      permissions = Array.from(new Set([...permissions, ...perms]));
    } else if (['MAKER', 'TREASURY_MAKER'].includes(role)) {
      const perms = ['ACCOUNTING_MANAGE', 'AUDIT_VIEW', 'VOUCHER_VIEW', 'REPORT_VIEW', 'BILLING_CREATE', 'COMPLIANCE_MANAGE'];
      permissions = Array.from(new Set([...permissions, ...perms]));
    } else if (role === 'GUARD') {
      const perms = ['VISITOR_MANAGE', 'PATROL_MANAGE', 'SOS_RESPOND'];
      permissions = Array.from(new Set([...permissions, ...perms]));
    }
    
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

    // TFS Rule 1: Only one ACTIVE Secretary or President per society unless previous assignment ended
    if (['SECRETARY', 'PRESIDENT'].includes(positionCode)) {
      const activeSingleCheck = await pool.query(`
        SELECT spa.id, u.first_name, u.last_name, u.email 
        FROM "${schema}".society_position_assignments spa
        JOIN "${schema}".position_master p ON spa.position_id = p.id
        LEFT JOIN platform.users u ON spa.user_id = u.id
        WHERE p.code = $1
          AND spa.user_id != $2
          AND spa.status = 'ACTIVE'
          AND (
            (spa.start_date <= $3 AND spa.end_date >= $3) OR
            (spa.start_date <= $4 AND spa.end_date >= $4) OR
            (spa.start_date >= $3 AND spa.end_date <= $4)
          )
        LIMIT 1
      `, [positionCode, userId, startDate, endDate]);

      if (activeSingleCheck.rows.length > 0) {
        if (req.body.replace_existing === true || req.body.replace_existing === 'true' || req.query.replace_existing === 'true') {
          await pool.query(`
            UPDATE "${schema}".society_position_assignments
            SET status = 'EXPIRED', end_date = CURRENT_DATE, notes = 'Auto-ended upon appointment of successor'
            WHERE id = $1
          `, [activeSingleCheck.rows[0].id]);
        } else {
          const holder = activeSingleCheck.rows[0];
          return res.status(400).json({ 
            error: `An active ${positionCode} already exists for this term: ${holder.first_name || ''} ${holder.last_name || ''} (${holder.email}). Please expire or end the current term first or select Replace Existing Term.` 
          });
        }
      }
    }

    // Check for overlapping assignments for the same user
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
      return res.status(400).json({ error: 'Overlapping active assignment exists for this user and position' });
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
    res.status(500).json({ error: err.message || 'Failed to assign position' });
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

const endAssignment = async (req, res) => {
  const { societyId, assignmentId } = req.params;
  try {
    const schema = getTenantSchemaName(societyId);
    const r = await pool.query(
      `UPDATE "${schema}".society_position_assignments
       SET status = 'ENDED', end_date = CURRENT_DATE
       WHERE id = $1 RETURNING *`,
      [assignmentId]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    await logAudit(req, 'END_POSITION_ASSIGNMENT', 'POSITION_ASSIGNMENT', assignmentId, null, { status: 'ENDED' });
    return res.json({ message: 'Position term ended successfully', assignment: r.rows[0] });
  } catch (err) {
    console.error('End assignment error:', err);
    res.status(500).json({ error: 'Failed to end position assignment' });
  }
};

module.exports = {
  getActivePermissions,
  assignPosition,
  endAssignment,
  getPositions,
  getAssignments
};
