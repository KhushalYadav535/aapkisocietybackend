const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');
const { isPostgresOnly } = require('./postgres');

const DB_PATH = path.join(__dirname, '../../data/db.json');

let db;

function getDb() {
  if (isPostgresOnly) {
    throw new Error('LowDB fallback is disabled (POSTGRES_ONLY=true).');
  }
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const adapter = new FileSync(DB_PATH);
    db = low(adapter);

    db.defaults({
      users: [],
      societies: [],
      wings: [],
      flats: [],
      bills: [],
      bill_items: [],
      payments: [],
      complaints: [],
      notices: [],
      notice_reads: [],
      visitors: [],
      facilities: [],
      facility_bookings: [],
      audit_logs: [],
      notifications: [],
      plans: [],
      feature_flags: [],
      compliance_events: [],
      mandates: [],
      privacy_requests: [],
      oauth_clients: [],
      access_tokens: [],
      gst_returns: [],
      tds_returns: [],
      consent_logs: [],
      // Missing collections that were causing silent failures
      vehicles: [],
      parking_slots: [],
      staff: [],
      staff_attendance: [],
      tenants: [],
      vendors: [],
      vendor_payments: [],
      meetings: [],
      meeting_votes: [],
      messages: [],
      documents: [],
      document_categories: [],
      accounting_entries: [],
      accounting_categories: [],
      // New feature collections
      sos_alerts: [],
      patrol_checkpoints: [],
      patrol_logs: [],
      emergency_contacts: [],
      assets: [],
      asset_service_logs: [],
    }).write();
  }
  return db;
}

function initializeDatabase() {
  return new Promise((resolve, reject) => {
    try {
      if (isPostgresOnly) {
        console.log('✅ LowDB skipped (POSTGRES_ONLY=true)');
        resolve(null);
        return;
      }
      const database = getDb();
      console.log('✅ Database initialized successfully');
      resolve(database);
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { getDb, initializeDatabase };
