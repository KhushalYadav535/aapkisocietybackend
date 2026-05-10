const { v4: uuidv4 } = require('uuid');
const { pool, isPostgresEnabled } = require('../config/postgres');
const { isPlatformRole } = require('../constants/roles');
const { sendRenewalReminderEmail } = require('../utils/email');

// ─── Create Notification ───────────────────────────────────────────────
exports.createNotification = async (req, res) => {
  try {
    const { title, message, type, target_type, target_id, target_society_id, priority, action_url } = req.body;
    const id = uuidv4();
    const now = new Date().toISOString();

    await pool.query(`
      INSERT INTO platform.notifications
        (id, title, message, type, target_type, target_id, target_society_id, priority, action_url, is_read, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [id, title, message, type || 'SYSTEM', target_type || 'ALL', target_id || null, target_society_id || null, priority || 'NORMAL', action_url || null, 0, now]);

    res.status(201).json({ id, message: 'Notification created' });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ error: 'Failed to create notification' });
  }
};

// ─── Get User Notifications ──────────────────────────────────────────
exports.getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, unread_only } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = [];
    let params = [];
    let idx = 1;

    // Show notifications for user's society or platform-wide
    if (req.user.society_id) {
      where.push(`(target_society_id = $${idx++} OR target_society_id IS NULL)`);
      params.push(req.user.society_id);
    }

    // For platform users, show all
    if (!isPlatformRole(req.user.role)) {
      where.push(`(target_id = $${idx++} OR target_id IS NULL)`);
      params.push(req.user.id);
    }

    if (unread_only === 'true') {
      where.push(`is_read = 0`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const result = await pool.query(`
      SELECT * FROM platform.notifications
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${idx++} OFFSET $${idx}
    `, [...params, parseInt(limit), offset]);

    const countResult = await pool.query(`
      SELECT COUNT(*) FROM platform.notifications ${whereClause}
    `, params);

    const unreadResult = await pool.query(`
      SELECT COUNT(*) FROM platform.notifications
      WHERE is_read = 0 ${whereClause.length ? 'AND ' + where.join(' AND ') : ''}
    `, params);

    res.json({
      notifications: result.rows,
      total: parseInt(countResult.rows[0].count),
      unread: parseInt(unreadResult.rows[0].count),
      page: parseInt(page)
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

// ─── Mark as Read ─────────────────────────────────────────────────────
exports.markAsRead = async (req, res) => {
  try {
    const { notification_id } = req.params;

    await pool.query(
      'UPDATE platform.notifications SET is_read = 1 WHERE id = $1',
      [notification_id]
    );

    res.json({ message: 'Marked as read' });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
};

// ─── Mark All as Read ─────────────────────────────────────────────────
exports.markAllAsRead = async (req, res) => {
  try {
    let where = [];
    let params = [];

    if (req.user.society_id) {
      where.push(`(target_society_id = $1 OR target_society_id IS NULL)`);
      params.push(req.user.society_id);
    } else {
      where.push(`target_id = $1`);
      params.push(req.user.id);
    }

    await pool.query(
      `UPDATE platform.notifications SET is_read = 1 WHERE is_read = 0 AND (${where.join(' AND ')})`,
      params
    );

    res.json({ message: 'All marked as read' });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
};

// ─── Renewal Reminder Cron (to be called by scheduler) ───────────────
exports.sendRenewalReminders = async (req, res) => {
  try {
    if (!isPlatformRole(req.user.role) && req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const days = [30, 15, 7, 3, 1];
    const today = new Date().toISOString().split('T')[0];
    const reminders = [];

    for (const day of days) {
      const reminderDate = new Date(Date.now() + day * 86400000).toISOString().split('T')[0];

      const societies = await pool.query(`
        SELECT s.id, s.name, s.subscription_plan, s.renewal_date, s.contact_email, s.contact_name,
               u.id as user_id, u.email
        FROM platform.societies s
        JOIN platform.users u ON u.society_id = s.id AND u.role IN ('ADMIN', 'TREASURER')
        WHERE s.subscription_status IN ('ACTIVE', 'TRIAL')
          AND s.renewal_date = $1
      `, [reminderDate]);

      for (const s of societies.rows) {
        const existing = await pool.query(
          'SELECT id FROM platform.notifications WHERE target_id = $1 AND type = $2 AND created_at > NOW() - INTERVAL \'1 day\'',
          [s.user_id, 'RENEWAL_REMINDER']
        );

        if (!existing.rows.length) {
          const id = uuidv4();
          await pool.query(`
            INSERT INTO platform.notifications
              (id, title, message, type, target_type, target_id, target_society_id, priority, action_url, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          `, [
            id,
            `Subscription Renewal in ${day} day${day > 1 ? 's' : ''}`,
            `Your ${s.subscription_plan} subscription renews on ${reminderDate}. Please ensure payment is processed.`,
            'RENEWAL_REMINDER',
            'USER',
            s.user_id,
            s.id,
            day <= 3 ? 'HIGH' : 'NORMAL',
            '/dashboard/billing',
            new Date().toISOString()
          ]);
          sendRenewalReminderEmail(s.email || s.contact_email, s.name, s.subscription_plan, day, reminderDate).catch(e => console.error('Renewal email failed:', e.message));
          reminders.push({ society: s.name, contact: s.contact_email, days });
        }
      }
    }

    res.json({ message: `Renewal reminders processed`, reminders });
  } catch (error) {
    console.error('Renewal reminders error:', error);
    res.status(500).json({ error: 'Failed to send renewal reminders' });
  }
};

// ─── Trial Expiry Reminders (scheduler) ──────────────────────────────
exports.sendTrialReminders = async (req, res) => {
  try {
    if (!isPlatformRole(req.user?.role) && req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const days = [7, 3, 1, 0];
    const reminders = [];

    for (const day of days) {
      const targetDate = new Date(Date.now() + day * 86400000).toISOString().split('T')[0];

      const societies = await pool.query(`
        SELECT s.id, s.name, s.subscription_plan, s.renewal_date, s.contact_email,
               u.id as user_id, u.email
        FROM platform.societies s
        JOIN platform.users u ON u.society_id = s.id AND u.role IN ('ADMIN', 'TREASURER')
        WHERE s.subscription_status = 'TRIAL'
          AND s.renewal_date = $1
      `, [targetDate]);

      for (const s of societies.rows) {
        const existing = await pool.query(
          'SELECT id FROM platform.notifications WHERE target_id = $1 AND type = $2 AND created_at > NOW() - INTERVAL \'1 day\'',
          [s.user_id, 'TRIAL_EXPIRY']
        );
        if (!existing.rows.length) {
          const id = uuidv4();
          const title = day === 0 ? 'Trial Expires Today!' : `Trial Expires in ${day} day${day > 1 ? 's' : ''}`;
          await pool.query(`
            INSERT INTO platform.notifications
              (id, title, message, type, target_type, target_id, target_society_id, priority, action_url, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          `, [id, title, `Your ${s.subscription_plan} trial ends on ${targetDate}. Subscribe to continue.`, 'TRIAL_EXPIRY', 'USER', s.user_id, s.id, day <= 1 ? 'HIGH' : 'NORMAL', '/dashboard/billing', new Date().toISOString()]);
          sendRenewalReminderEmail(s.email || s.contact_email, s.name, s.subscription_plan + ' (Trial)', day, targetDate).catch(() => {});
          reminders.push({ society: s.name, days: day });
        }
      }
    }

    res.json({ message: 'Trial reminders processed', reminders });
  } catch (error) {
    console.error('Trial reminders error:', error);
    res.status(500).json({ error: 'Failed to send trial reminders' });
  }
};

// ─── Renewal Banner Data (for in-app banner) ─────────────────────────
exports.getRenewalBanner = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) return res.json({ banner: null });

    const result = await pool.query(
      'SELECT subscription_status, subscription_plan, renewal_date, onboarding_state FROM platform.societies WHERE id = $1 LIMIT 1',
      [societyId]
    );
    if (!result.rows.length) return res.json({ banner: null });

    const soc = result.rows[0];
    const now = new Date();
    const renewal = soc.renewal_date ? new Date(soc.renewal_date) : null;
    const daysLeft = renewal ? Math.ceil((renewal.getTime() - now.getTime()) / 86400000) : null;

    let banner = null;

    if (soc.subscription_status === 'SUSPENDED') {
      banner = { type: 'error', title: 'Subscription Suspended', message: 'Your society subscription is suspended. Contact platform admin.', action: '/dashboard/billing' };
    } else if (soc.subscription_status === 'TRIAL' && daysLeft !== null && daysLeft <= 7) {
      banner = { type: 'warning', title: `Trial Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`, message: 'Subscribe now to continue using all features.', action: '/dashboard/billing' };
    } else if (daysLeft !== null && daysLeft <= 30 && daysLeft > 0) {
      banner = { type: 'info', title: `Renewal Due in ${daysLeft} days`, message: `Your ${soc.subscription_plan} plan renews on ${soc.renewal_date}.`, action: '/dashboard/billing' };
    } else if (daysLeft !== null && daysLeft <= 0 && soc.subscription_status !== 'OFFBOARDED') {
      banner = { type: 'error', title: 'Subscription Overdue', message: 'Your subscription renewal is overdue. Please process payment.', action: '/dashboard/billing' };
    }

    res.json({ banner });
  } catch (error) {
    console.error('Renewal banner error:', error);
    res.json({ banner: null });
  }
};