const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const { initializeDatabase } = require('./config/database');
const { ensurePlatformSchema, isPostgresEnabled, isPostgresOnly, pool, createTenantSchema } = require('./config/postgres');
const authRoutes = require('./routes/auth.routes');
const societyRoutes = require('./routes/society.routes');
const memberRoutes = require('./routes/member.routes');
const billingRoutes = require('./routes/billing.routes');
const complaintRoutes = require('./routes/complaint.routes');
const noticeRoutes = require('./routes/notice.routes');
const visitorRoutes = require('./routes/visitor.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const facilityRoutes = require('./routes/facility.routes');
const planRoutes = require('./routes/plan.routes');
const featureRoutes = require('./routes/feature.routes');
const mandateRoutes = require('./routes/mandate.routes');
const complianceRoutes = require('./routes/compliance.routes');
const notificationRoutes = require('./routes/notification.routes');
const privacyRoutes = require('./routes/privacy.routes');
const oauthRoutes = require('./routes/oauth.routes');
const taxRoutes = require('./routes/tax.routes');
const accountingRoutes = require('./routes/accounting.routes');
const auditRoutes = require('./routes/audit.routes');
const reportsRoutes = require('./routes/reports.routes');
const staffRoutes = require('./routes/staff.routes');
const documentRoutes = require('./routes/document.routes');
const noticeReadRoutes = require('./routes/notice-read.routes');
const tenantRoutes = require('./routes/tenant.routes');
const vehicleRoutes = require('./routes/vehicle.routes');
const vendorRoutes = require('./routes/vendor.routes');
const messageRoutes = require('./routes/message.routes');
const meetingRoutes = require('./routes/meeting.routes');
const platformRoutes = require('./routes/platform.routes');
const sosRoutes = require('./routes/sos.routes');
const patrolRoutes = require('./routes/patrol.routes');
const emergencyContactRoutes = require('./routes/emergency-contacts.routes');
const assetRoutes = require('./routes/asset.routes');
const propertyRoutes = require('./routes/property.routes');
const scrollerRoutes = require('./routes/scroller.routes');
const exportRoutes = require('./routes/export.routes');
const { enforceSuspension } = require('./middleware/suspension');

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    // In development, allow any localhost port
    if (process.env.NODE_ENV === 'development' && /^http:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    // In production, check against FRONTEND_URL
    const allowed = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map(u => u.trim());
    if (allowed.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true
}));

// Rate limiting
const isDev = process.env.NODE_ENV === 'development';

// Keep brute-force protection on auth routes (relaxed in dev).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 300 : 60,
  message: { error: 'Too many auth attempts, please try again later.' }
});
app.use('/api/auth', authLimiter);

// General API limiter. In dev keep it high to avoid local HMR/polling lockouts.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 2000 : 300,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.path.startsWith('/api/auth')
});
app.use('/api/', apiLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Suspension enforcement — blocks write operations for suspended/offboarded societies
// Runs after all routes set req.user via per-route authenticate middleware
// Uses optional chaining: no-ops for unauthenticated or platform admin requests
app.use('/api', (req, res, next) => {
  // Skip for auth routes (user not yet set)
  if (req.path.startsWith('/auth')) return next();
  enforceSuspension(req, res, next);
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/societies', societyRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/notices', noticeRoutes);
app.use('/api/visitors', visitorRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/facilities', facilityRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/features', featureRoutes);
app.use('/api/mandates', mandateRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/privacy', privacyRoutes);
app.use('/api/oauth', oauthRoutes);
app.use('/api/tax', taxRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/notice-reads', noticeReadRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/platform', platformRoutes);
app.use('/api/sos', sosRoutes);
app.use('/api/patrol', patrolRoutes);
app.use('/api/emergency-contacts', emergencyContactRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/scrollers', scrollerRoutes);
app.use('/api/export', exportRoutes);

// Health check
app.get('/api/health', async (req, res) => {
  let postgres = { enabled: isPostgresEnabled, connected: false };
  if (isPostgresEnabled && pool) {
    try {
      await pool.query('SELECT 1');
      postgres.connected = true;
    } catch (error) {
      postgres.connected = false;
      postgres.error = error.message;
    }
  }

  const lowdb = {
    enabled: !isPostgresOnly,
    fallback_allowed: !isPostgresOnly
  };

  const healthy = isPostgresEnabled ? postgres.connected : lowdb.enabled;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    runtime: {
      postgres_only_mode: isPostgresOnly,
      postgres,
      lowdb
    }
  });
});

// Liveness probe: process is up
app.get('/api/health/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString()
  });
});

// Readiness probe: dependencies are ready
app.get('/api/health/ready', async (req, res) => {
  if (!isPostgresEnabled) {
    return res.status(200).json({
      status: 'ready',
      mode: 'lowdb',
      timestamp: new Date().toISOString()
    });
  }

  try {
    await pool.query('SELECT 1');
    return res.status(200).json({
      status: 'ready',
      mode: isPostgresOnly ? 'postgres-only' : 'hybrid',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(503).json({
      status: 'not_ready',
      mode: isPostgresOnly ? 'postgres-only' : 'hybrid',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Initialize database and start server
initializeDatabase().then(() => {
  if (isPostgresEnabled) {
    ensurePlatformSchema()
      .then(async () => {
        // Provision tenant tables for all existing societies
        try {
          const res = await pool.query('SELECT id FROM platform.societies');
          for (const row of res.rows) {
            await createTenantSchema(row.id);
          }
          if (res.rows.length > 0) console.log(`✅ Ensured tenant tables for ${res.rows.length} societies`);
        } catch (_) { /* societies table may not exist yet */ }
      })
      .catch((err) => {
        console.error('Failed to prepare PostgreSQL schemas:', err.message);
      });
  }
  app.listen(PORT, () => {
    console.log(`🏢 AapkiSociety Backend running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

module.exports = app;
