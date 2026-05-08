const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { initializeDatabase, getDb } = require('../config/database');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

async function seed() {
  await initializeDatabase();
  const db = getDb();

  console.log('🌱 Seeding database...');

  // Clear existing data
  db.setState({ users: [], societies: [], wings: [], flats: [], bills: [], bill_items: [], payments: [], complaints: [], notices: [], visitors: [], facilities: [], facility_bookings: [], audit_logs: [], notifications: [] }).write();

  const now = new Date().toISOString();
  const societyId = uuidv4();

  // Create society
  db.get('societies').push({
    id: societyId, name: 'Sunrise Heights CHS', registration_number: 'MH/CHS/2024/1234',
    address: '123, MG Road, Andheri West', city: 'Mumbai', state: 'Maharashtra', pincode: '400053',
    total_units: 120, total_wings: 4, status: 'ACTIVE', subscription_plan: 'AI_PRO',
    subscription_status: 'ACTIVE', created_at: now, updated_at: now
  }).write();

  // Create wings
  const wings = ['A', 'B', 'C', 'D'];
  const wingIds = {};
  for (const w of wings) {
    const wid = uuidv4();
    wingIds[w] = wid;
    db.get('wings').push({ id: wid, society_id: societyId, name: `Wing ${w}`, total_floors: 10, flats_per_floor: 4, created_at: now }).write();
  }

  // Create flats
  for (const w of wings) {
    for (let floor = 1; floor <= 3; floor++) {
      for (let flat = 1; flat <= 4; flat++) {
        db.get('flats').push({
          id: uuidv4(), society_id: societyId, wing_id: wingIds[w],
          flat_number: `${w}-${floor}0${flat}`, floor_number: floor,
          area_sqft: 850 + Math.floor(Math.random() * 500),
          flat_type: ['1BHK', '2BHK', '3BHK'][Math.floor(Math.random() * 3)],
          is_occupied: 1, created_at: now
        }).write();
      }
    }
  }

  // Create users
  const hashedPassword = await bcrypt.hash('Admin@123', 12);
  const adminId = uuidv4();
  const treasurerId = uuidv4();

  const mkUser = (id, email, first, last, phone, role, flat, wing) => ({
    id, email, password: hashedPassword, first_name: first, last_name: last,
    phone, role, society_id: role === 'PLATFORM_ADMIN' ? null : societyId,
    flat_number: flat, wing, is_active: 1, is_verified: 1, mfa_enabled: 0,
    avatar_url: null, created_at: now, updated_at: now
  });

  db.get('users').push(mkUser(uuidv4(), 'platform@aapkisociety.com', 'Platform', 'Admin', '9999999999', 'PLATFORM_ADMIN', null, null)).write();
  db.get('users').push(mkUser(adminId, 'admin@sunrise.com', 'Rajesh', 'Sharma', '9876543210', 'ADMIN', 'A-101', 'A')).write();
  db.get('users').push(mkUser(treasurerId, 'treasurer@sunrise.com', 'Priya', 'Patel', '9876543211', 'TREASURER', 'A-102', 'A')).write();
  db.get('users').push(mkUser(uuidv4(), 'committee@sunrise.com', 'Amit', 'Desai', '9876543212', 'COMMITTEE', 'B-201', 'B')).write();

  const residentNames = [
    { first: 'Suresh', last: 'Kumar', flat: 'A-301' },
    { first: 'Meena', last: 'Iyer', flat: 'A-401' },
    { first: 'Vikram', last: 'Singh', flat: 'B-101' },
    { first: 'Neha', last: 'Gupta', flat: 'B-301' },
    { first: 'Arun', last: 'Joshi', flat: 'C-101' },
    { first: 'Kavita', last: 'Reddy', flat: 'C-201' },
    { first: 'Deepak', last: 'Nair', flat: 'D-101' },
    { first: 'Anjali', last: 'Mehta', flat: 'D-201' },
  ];

  const residentIds = [];
  for (const r of residentNames) {
    const rid = uuidv4();
    residentIds.push(rid);
    db.get('users').push(mkUser(rid, `${r.first.toLowerCase()}@sunrise.com`, r.first, r.last, `98765${Math.floor(10000 + Math.random() * 90000)}`, 'RESIDENT', r.flat, r.flat.split('-')[0])).write();
  }

  // Sample bills
  const billStatuses = ['PENDING', 'APPROVED', 'PAID', 'OVERDUE'];
  const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0];
  const tenDaysLater = new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0];
  for (const rid of residentIds) {
    const status = billStatuses[Math.floor(Math.random() * billStatuses.length)];
    db.get('bills').push({
      id: uuidv4(), society_id: societyId, flat_id: null, member_id: rid,
      bill_number: `BIL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 5)}`,
      bill_date: fiveDaysAgo, due_date: tenDaysLater, amount: 3500, tax_amount: 0,
      total_amount: 3500, paid_amount: status === 'PAID' ? 3500 : 0,
      status, bill_type: 'MAINTENANCE', billing_period: 'May 2026',
      description: null, created_by: adminId, approved_by: null,
      created_at: now, updated_at: now
    }).write();
  }

  // Sample complaints
  const complaints = [
    { title: 'Water leakage in parking area', category: 'PLUMBING', priority: 'HIGH', status: 'OPEN' },
    { title: 'Lift not working in Wing B', category: 'ELECTRICAL', priority: 'URGENT', status: 'IN_PROGRESS' },
    { title: 'Garden maintenance required', category: 'GENERAL', priority: 'LOW', status: 'RESOLVED' },
    { title: 'Security camera not functioning', category: 'SECURITY', priority: 'HIGH', status: 'OPEN' },
    { title: 'Common area lights flickering', category: 'ELECTRICAL', priority: 'MEDIUM', status: 'IN_PROGRESS' },
  ];
  for (const c of complaints) {
    db.get('complaints').push({
      id: uuidv4(), society_id: societyId,
      raised_by: residentIds[Math.floor(Math.random() * residentIds.length)],
      assigned_to: null, title: c.title, description: null,
      category: c.category, priority: c.priority, status: c.status,
      resolution_notes: null, resolved_at: null, created_at: now, updated_at: now
    }).write();
  }

  // Sample notices
  const notices = [
    { title: 'Annual General Meeting - June 2026', content: 'Dear residents, the AGM is scheduled for June 15, 2026 at 6:00 PM in the community hall. All members are requested to attend.', category: 'AGM', priority: 'HIGH' },
    { title: 'Water Tank Cleaning Schedule', content: 'Water tank cleaning will be done on May 20, 2026. Please store water for the day.', category: 'MAINTENANCE', priority: 'NORMAL' },
    { title: 'Diwali Celebration 2026', content: 'Society Diwali celebration planned for October. Suggestions welcome from all residents.', category: 'EVENT', priority: 'NORMAL' },
    { title: 'New Parking Rules Effective June 1', content: 'New parking allocation rules will be effective from June 1, 2026. Please check the notice board for details.', category: 'RULES', priority: 'HIGH' },
  ];
  for (const n of notices) {
    db.get('notices').push({
      id: uuidv4(), society_id: societyId, title: n.title, content: n.content,
      category: n.category, priority: n.priority, published_by: adminId,
      is_published: 1, publish_date: now, expiry_date: null, attachment_url: null,
      created_at: now, updated_at: now
    }).write();
  }

  // Sample visitors
  const visitors = [
    { name: 'Ramesh Delivery', phone: '9876500001', purpose: 'Package Delivery', status: 'CHECKED_OUT' },
    { name: 'Anil Plumber', phone: '9876500002', purpose: 'Plumbing Repair', status: 'CHECKED_IN' },
    { name: 'Sita Verma', phone: '9876500003', purpose: 'Guest Visit', status: 'CHECKED_IN' },
    { name: 'Courier Service', phone: '9876500004', purpose: 'Document Delivery', status: 'CHECKED_OUT' },
  ];
  for (const v of visitors) {
    db.get('visitors').push({
      id: uuidv4(), society_id: societyId, visitor_name: v.name,
      visitor_phone: v.phone, purpose: v.purpose, flat_id: null,
      visiting_member_id: null, vehicle_number: null, check_in: now,
      check_out: v.status === 'CHECKED_OUT' ? now : null,
      status: v.status, approved_by: null, guard_notes: null, created_at: now
    }).write();
  }

  // Sample facilities
  const facilities = [
    { name: 'Community Hall', type: 'HALL', capacity: 200, rate_per_hour: 500, rate_per_day: 5000 },
    { name: 'Swimming Pool', type: 'POOL', capacity: 30, rate_per_hour: 0, rate_per_day: 0 },
    { name: 'Gymnasium', type: 'GYM', capacity: 20, rate_per_hour: 0, rate_per_day: 0 },
    { name: "Children's Play Area", type: 'PLAYGROUND', capacity: 50, rate_per_hour: 0, rate_per_day: 0 },
    { name: 'EV Charging Station', type: 'EV_CHARGING', capacity: 4, rate_per_hour: 15, rate_per_day: 0 },
  ];
  for (const f of facilities) {
    db.get('facilities').push({
      id: uuidv4(), society_id: societyId, name: f.name, description: null,
      type: f.type, capacity: f.capacity, rate_per_hour: f.rate_per_hour,
      rate_per_day: f.rate_per_day, is_active: 1, rules: null, created_at: now
    }).write();
  }

  // Sample payments
  for (let i = 0; i < 5; i++) {
    const pDate = new Date(Date.now() - i * 86400000).toISOString();
    db.get('payments').push({
      id: uuidv4(), society_id: societyId, bill_id: null,
      member_id: residentIds[i % residentIds.length], amount: 3500,
      payment_method: ['UPI', 'NACH', 'NEFT', 'CASH', 'CHEQUE'][i],
      payment_reference: null, gateway_transaction_id: null,
      status: 'SUCCESS', payment_date: pDate, created_at: pDate
    }).write();
  }

  console.log('✅ Database seeded successfully!');
  console.log('');
  console.log('📋 Login Credentials:');
  console.log('   Platform Admin: platform@aapkisociety.com / Admin@123');
  console.log('   Society Admin:  admin@sunrise.com / Admin@123');
  console.log('   Treasurer:      treasurer@sunrise.com / Admin@123');
  console.log('   Resident:       suresh@sunrise.com / Admin@123');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
