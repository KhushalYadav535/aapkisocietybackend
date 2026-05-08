require('dotenv').config();
const { getDb } = require('../config/database');
const { pool, ensurePlatformSchema, createTenantSchema, getTenantSchemaName } = require('../config/postgres');

const isoNow = () => new Date().toISOString();
const asJson = (value, fallback) => JSON.stringify(value ?? fallback);

async function migrate() {
  if (!pool) {
    throw new Error('DATABASE_URL not set. Cannot migrate to PostgreSQL.');
  }

  await ensurePlatformSchema();
  const db = getDb();
  const societies = db.get('societies').value();

  await pool.query(`CREATE TABLE IF NOT EXISTS platform.societies (
    id TEXT PRIMARY KEY,
    name TEXT,
    registration_number TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    pincode TEXT,
    gst_number TEXT,
    pan_number TEXT,
    total_units INTEGER DEFAULT 0,
    total_wings INTEGER DEFAULT 0,
    status TEXT,
    subscription_plan TEXT,
    subscription_status TEXT,
    active_modules JSONB DEFAULT '[]'::jsonb,
    bank_name TEXT,
    bank_account_number TEXT,
    bank_ifsc TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform.plans (
    id TEXT PRIMARY KEY,
    name TEXT,
    code TEXT UNIQUE,
    price NUMERIC DEFAULT 0,
    features JSONB DEFAULT '[]'::jsonb,
    color TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform.oauth_clients (
    id TEXT PRIMARY KEY,
    client_id TEXT UNIQUE,
    client_secret TEXT,
    society_id TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform.access_tokens (
    id TEXT PRIMARY KEY,
    client_id TEXT,
    token TEXT,
    scope TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform.consent_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    consent JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform.privacy_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    society_id TEXT,
    type TEXT,
    status TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`ALTER TABLE platform.users ADD COLUMN IF NOT EXISTS consent JSONB DEFAULT '{}'::jsonb`);

  for (const user of db.get('users').value()) {
    await pool.query(
      `INSERT INTO platform.users
      (id,email,password,first_name,last_name,role,society_id,flat_number,wing,phone,avatar_url,is_active,is_verified,mfa_enabled,mfa_method,consent,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18)
      ON CONFLICT (id) DO NOTHING`,
      [
        user.id, user.email, user.password, user.first_name, user.last_name, user.role,
        user.society_id || null, user.flat_number || null, user.wing || null, user.phone || null,
        user.avatar_url || null, user.is_active ?? 1, user.is_verified ?? 1, user.mfa_enabled ?? 0,
        user.mfa_method || null, asJson(user.consent, {}), user.created_at || isoNow(), user.updated_at || isoNow()
      ]
    );
  }
  for (const plan of db.get('plans').value()) {
    await pool.query(
      `INSERT INTO platform.plans (id,name,code,price,features,color,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [plan.id, plan.name, plan.code, plan.price || 0, asJson(plan.features, []), plan.color || null, plan.created_at || isoNow(), plan.updated_at || isoNow()]
    );
  }
  for (const c of db.get('oauth_clients').value()) {
    await pool.query(
      `INSERT INTO platform.oauth_clients (id,client_id,client_secret,society_id,is_active,created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [c.id || c.client_id, c.client_id, c.client_secret, c.society_id || null, c.is_active ?? 1, c.created_at || isoNow()]
    );
  }
  for (const t of db.get('access_tokens').value()) {
    await pool.query(
      `INSERT INTO platform.access_tokens (id,client_id,token,scope,created_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [t.id, t.client_id, t.token, t.scope || '', t.created_at || isoNow()]
    );
  }
  for (const c of db.get('consent_logs').value()) {
    await pool.query(
      `INSERT INTO platform.consent_logs (id,user_id,consent,updated_at)
       VALUES ($1,$2,$3::jsonb,$4)
       ON CONFLICT (id) DO NOTHING`,
      [c.id, c.user_id, asJson(c.consent, {}), c.updated_at || isoNow()]
    );
  }
  for (const r of db.get('privacy_requests').value()) {
    await pool.query(
      `INSERT INTO platform.privacy_requests (id,user_id,society_id,type,status,reason,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [r.id, r.user_id, r.society_id, r.type || 'ERASURE', r.status || 'PENDING', r.reason || null, r.created_at || isoNow()]
    );
  }

  for (const society of societies) {
    await pool.query(
      `INSERT INTO platform.societies
      (id,name,registration_number,address,city,state,pincode,gst_number,pan_number,total_units,total_wings,status,subscription_plan,subscription_status,active_modules,bank_name,bank_account_number,bank_ifsc,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20)
      ON CONFLICT (id) DO NOTHING`,
      [
        society.id, society.name || society.society_name || 'Unknown Society',
        society.registration_number || null, society.address || null, society.city || null, society.state || 'Maharashtra',
        society.pincode || null, society.gst_number || null, society.pan_number || null,
        society.total_units || 0, society.total_wings || 0, society.status || 'ACTIVE',
        society.subscription_plan || 'CORE', society.subscription_status || 'ACTIVE',
        asJson(society.active_modules, ['MEMBERS', 'BILLING', 'NOTICES', 'COMPLAINTS']),
        society.bank_name || null, society.bank_account_number || null, society.bank_ifsc || null,
        society.created_at || isoNow(), society.updated_at || isoNow()
      ]
    );
    await createTenantSchema(society.id);
    const schema = getTenantSchemaName(society.id);

    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.users (id TEXT PRIMARY KEY,email TEXT,role TEXT,first_name TEXT,last_name TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.wings (id TEXT PRIMARY KEY,society_id TEXT,name TEXT,total_floors INTEGER,flats_per_floor INTEGER,created_at TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.flats (id TEXT PRIMARY KEY,society_id TEXT,wing_id TEXT,flat_number TEXT,floor_number INTEGER,area_sqft NUMERIC,flat_type TEXT,is_occupied INTEGER,created_at TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.bills (id TEXT PRIMARY KEY,society_id TEXT,flat_id TEXT,member_id TEXT,bill_number TEXT,bill_date DATE,due_date DATE,amount NUMERIC,tax_amount NUMERIC,total_amount NUMERIC,paid_amount NUMERIC,status TEXT,bill_type TEXT,billing_period TEXT,description TEXT,created_by TEXT,approved_by TEXT,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.bill_items (id TEXT PRIMARY KEY,bill_id TEXT,head_name TEXT,amount NUMERIC,tax_rate NUMERIC,tax_amount NUMERIC,total NUMERIC)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.payments (id TEXT PRIMARY KEY,society_id TEXT,bill_id TEXT,member_id TEXT,amount NUMERIC,payment_method TEXT,payment_reference TEXT,gateway_transaction_id TEXT,status TEXT,payment_date TIMESTAMPTZ,created_at TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.complaints (id TEXT PRIMARY KEY,society_id TEXT,raised_by TEXT,assigned_to TEXT,title TEXT,description TEXT,category TEXT,priority TEXT,status TEXT,resolution_notes TEXT,resolved_at TIMESTAMPTZ,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.notices (id TEXT PRIMARY KEY,society_id TEXT,title TEXT,content TEXT,category TEXT,priority TEXT,published_by TEXT,is_published INTEGER,publish_date TIMESTAMPTZ,expiry_date DATE,attachment_url TEXT,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.visitors (id TEXT PRIMARY KEY,society_id TEXT,visitor_name TEXT,visitor_phone TEXT,purpose TEXT,flat_id TEXT,visiting_member_id TEXT,vehicle_number TEXT,check_in TIMESTAMPTZ,check_out TIMESTAMPTZ,status TEXT,approved_by TEXT,guard_notes TEXT,created_at TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.facilities (id TEXT PRIMARY KEY,society_id TEXT,name TEXT,description TEXT,type TEXT,capacity INTEGER,rate_per_hour NUMERIC,rate_per_day NUMERIC,is_active INTEGER,rules TEXT,created_at TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.facility_bookings (id TEXT PRIMARY KEY,facility_id TEXT,society_id TEXT,booked_by TEXT,booking_date DATE,start_time TEXT,end_time TEXT,purpose TEXT,status TEXT,amount NUMERIC,created_at TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.feature_flags (id TEXT PRIMARY KEY,society_id TEXT,feature_key TEXT,enabled BOOLEAN,reason TEXT,created_by TEXT,updated_by TEXT,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.compliance_events (id TEXT PRIMARY KEY,society_id TEXT,type TEXT,title TEXT,due_date DATE,status TEXT,lead_days INTEGER,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.notifications (id TEXT PRIMARY KEY,society_id TEXT,channel TEXT,recipients JSONB,template_key TEXT,subject TEXT,body TEXT,status TEXT,sent_at TIMESTAMPTZ,created_by TEXT,created_at TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.mandates (id TEXT PRIMARY KEY,society_id TEXT,member_id TEXT,type TEXT,amount_limit NUMERIC,status TEXT,provider_ref TEXT,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.gst_returns (id TEXT PRIMARY KEY,society_id TEXT,return_type TEXT,period TEXT,payload JSONB,status TEXT,created_at TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.tds_returns (id TEXT PRIMARY KEY,society_id TEXT,form_type TEXT,period TEXT,payload JSONB,status TEXT,created_at TIMESTAMPTZ)`);

    const insertMany = async (table, rows, map) => {
      for (const row of rows) {
        const { sql, values } = map(row);
        await pool.query(sql.replaceAll('__TABLE__', `${schema}.${table}`), values);
      }
    };

    await insertMany('users', db.get('users').filter({ society_id: society.id }).value(), (u) => ({
      sql: 'INSERT INTO __TABLE__ (id,email,role,first_name,last_name,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
      values: [u.id, u.email, u.role, u.first_name, u.last_name, u.created_at || isoNow()]
    }));
    await insertMany('wings', db.get('wings').filter({ society_id: society.id }).value(), (w) => ({
      sql: 'INSERT INTO __TABLE__ (id,society_id,name,total_floors,flats_per_floor,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
      values: [w.id, w.society_id, w.name, w.total_floors || 0, w.flats_per_floor || 0, w.created_at || isoNow()]
    }));
    await insertMany('flats', db.get('flats').filter({ society_id: society.id }).value(), (f) => ({
      sql: 'INSERT INTO __TABLE__ (id,society_id,wing_id,flat_number,floor_number,area_sqft,flat_type,is_occupied,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING',
      values: [f.id, f.society_id, f.wing_id || null, f.flat_number, f.floor_number || null, f.area_sqft || null, f.flat_type || null, f.is_occupied ?? 0, f.created_at || isoNow()]
    }));
    await insertMany('bills', db.get('bills').filter({ society_id: society.id }).value(), (b) => ({
      sql: 'INSERT INTO __TABLE__ (id,society_id,flat_id,member_id,bill_number,bill_date,due_date,amount,tax_amount,total_amount,paid_amount,status,bill_type,billing_period,description,created_by,approved_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (id) DO NOTHING',
      values: [b.id,b.society_id,b.flat_id||null,b.member_id||null,b.bill_number,b.bill_date||null,b.due_date||null,b.amount||0,b.tax_amount||0,b.total_amount||0,b.paid_amount||0,b.status,b.bill_type||null,b.billing_period||null,b.description||null,b.created_by||null,b.approved_by||null,b.created_at||isoNow(),b.updated_at||isoNow()]
    }));
    await insertMany('bill_items', db.get('bill_items').value(), (i) => ({
      sql: 'INSERT INTO __TABLE__ (id,bill_id,head_name,amount,tax_rate,tax_amount,total) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING',
      values: [i.id, i.bill_id, i.head_name, i.amount || 0, i.tax_rate || 0, i.tax_amount || 0, i.total || 0]
    }));
    await insertMany('payments', db.get('payments').filter({ society_id: society.id }).value(), (p) => ({
      sql: 'INSERT INTO __TABLE__ (id,society_id,bill_id,member_id,amount,payment_method,payment_reference,gateway_transaction_id,status,payment_date,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING',
      values: [p.id,p.society_id,p.bill_id||null,p.member_id||null,p.amount||0,p.payment_method||null,p.payment_reference||null,p.gateway_transaction_id||null,p.status||null,p.payment_date||isoNow(),p.created_at||isoNow()]
    }));
    await insertMany('complaints', db.get('complaints').filter({ society_id: society.id }).value(), (c) => ({
      sql: 'INSERT INTO __TABLE__ (id,society_id,raised_by,assigned_to,title,description,category,priority,status,resolution_notes,resolved_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING',
      values: [c.id,c.society_id,c.raised_by||null,c.assigned_to||null,c.title,c.description||null,c.category||null,c.priority||null,c.status||null,c.resolution_notes||null,c.resolved_at||null,c.created_at||isoNow(),c.updated_at||isoNow()]
    }));
    await insertMany('notices', db.get('notices').filter({ society_id: society.id }).value(), (n) => ({
      sql: 'INSERT INTO __TABLE__ (id,society_id,title,content,category,priority,published_by,is_published,publish_date,expiry_date,attachment_url,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING',
      values: [n.id,n.society_id,n.title,n.content,n.category||null,n.priority||null,n.published_by||null,n.is_published??0,n.publish_date||null,n.expiry_date||null,n.attachment_url||null,n.created_at||isoNow(),n.updated_at||isoNow()]
    }));
    await insertMany('visitors', db.get('visitors').filter({ society_id: society.id }).value(), (v) => ({
      sql: 'INSERT INTO __TABLE__ (id,society_id,visitor_name,visitor_phone,purpose,flat_id,visiting_member_id,vehicle_number,check_in,check_out,status,approved_by,guard_notes,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING',
      values: [v.id,v.society_id,v.visitor_name,v.visitor_phone||null,v.purpose||null,v.flat_id||null,v.visiting_member_id||null,v.vehicle_number||null,v.check_in||isoNow(),v.check_out||null,v.status||null,v.approved_by||null,v.guard_notes||null,v.created_at||isoNow()]
    }));
    await insertMany('facilities', db.get('facilities').filter({ society_id: society.id }).value(), (f) => ({
      sql: 'INSERT INTO __TABLE__ (id,society_id,name,description,type,capacity,rate_per_hour,rate_per_day,is_active,rules,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING',
      values: [f.id,f.society_id,f.name,f.description||null,f.type||null,f.capacity||null,f.rate_per_hour||0,f.rate_per_day||0,f.is_active??1,f.rules||null,f.created_at||isoNow()]
    }));
    await insertMany('facility_bookings', db.get('facility_bookings').filter({ society_id: society.id }).value(), (b) => ({
      sql: 'INSERT INTO __TABLE__ (id,facility_id,society_id,booked_by,booking_date,start_time,end_time,purpose,status,amount,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING',
      values: [b.id,b.facility_id,b.society_id,b.booked_by||null,b.booking_date||null,b.start_time||null,b.end_time||null,b.purpose||null,b.status||null,b.amount||0,b.created_at||isoNow()]
    }));
    await insertMany('feature_flags', db.get('feature_flags').filter({ society_id: society.id }).value(), (f) => ({
      sql: 'INSERT INTO __TABLE__ (id,society_id,feature_key,enabled,reason,created_by,updated_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING',
      values: [f.id,f.society_id,f.feature_key,!!f.enabled,f.reason||null,f.created_by||null,f.updated_by||null,f.created_at||isoNow(),f.updated_at||isoNow()]
    }));
    await insertMany('compliance_events', db.get('compliance_events').filter({ society_id: society.id }).value(), (e) => ({
      sql: 'INSERT INTO __TABLE__ (id,society_id,type,title,due_date,status,lead_days,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING',
      values: [e.id,e.society_id,e.type,e.title,e.due_date||null,e.status||'PENDING',e.lead_days||3,e.created_at||isoNow(),e.updated_at||isoNow()]
    }));
    await insertMany('notifications', db.get('notifications').filter({ society_id: society.id }).value(), (n) => ({
      sql: 'INSERT INTO __TABLE__ (id,society_id,channel,recipients,template_key,subject,body,status,sent_at,created_by,created_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING',
      values: [n.id,n.society_id,n.channel||'EMAIL',asJson(n.recipients,[]),n.template_key||'custom',n.subject||null,n.body||'',n.status||'SENT',n.sent_at||null,n.created_by||null,n.created_at||isoNow()]
    }));
    await insertMany('mandates', db.get('mandates').filter({ society_id: society.id }).value(), (m) => ({
      sql: 'INSERT INTO __TABLE__ (id,society_id,member_id,type,amount_limit,status,provider_ref,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING',
      values: [m.id,m.society_id,m.member_id||null,m.type||'UPI_AUTOPAY',m.amount_limit||0,m.status||'ACTIVE',m.provider_ref||null,m.created_at||isoNow(),m.updated_at||isoNow()]
    }));
    await insertMany('gst_returns', db.get('gst_returns').filter({ society_id: society.id }).value(), (g) => ({
      sql: 'INSERT INTO __TABLE__ (id,society_id,return_type,period,payload,status,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) ON CONFLICT (id) DO NOTHING',
      values: [g.id,g.society_id,g.return_type||'GSTR-1',g.period||null,asJson(g.payload,{}),g.status||'GENERATED',g.created_at||isoNow()]
    }));
    await insertMany('tds_returns', db.get('tds_returns').filter({ society_id: society.id }).value(), (t) => ({
      sql: 'INSERT INTO __TABLE__ (id,society_id,form_type,period,payload,status,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) ON CONFLICT (id) DO NOTHING',
      values: [t.id,t.society_id,t.form_type||'26Q',t.period||null,asJson(t.payload,{}),t.status||'GENERATED',t.created_at||isoNow()]
    }));
  }

  console.log(`Migrated ${societies.length} societies and all core collections to PostgreSQL.`);
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
