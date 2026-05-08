const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');

exports.getMandates = (req, res) => {
  const db = getDb();
  let mandates;
  if (req.user.role === 'RESIDENT') {
    mandates = db.get('mandates').filter({ member_id: req.user.id }).value();
  } else {
    mandates = db.get('mandates').filter({ society_id: req.user.society_id }).value();
  }
  res.json({ mandates });
};

exports.createMandate = (req, res) => {
  const db = getDb();
  const now = new Date().toISOString();
  const mandate = {
    id: uuidv4(),
    society_id: req.user.society_id,
    member_id: req.user.id,
    type: req.body.type || 'UPI_AUTOPAY',
    amount_limit: Number(req.body.amount_limit || 0),
    status: 'ACTIVE',
    provider_ref: req.body.provider_ref || null,
    created_at: now,
    updated_at: now
  };
  db.get('mandates').push(mandate).write();
  res.status(201).json({ mandate });
};

exports.updateMandateStatus = (req, res) => {
  const db = getDb();
  const status = req.body.status;
  db.get('mandates').find({ id: req.params.id }).assign({
    status,
    updated_at: new Date().toISOString()
  }).write();
  const mandate = db.get('mandates').find({ id: req.params.id }).value();
  if (!mandate) return res.status(404).json({ error: 'Mandate not found' });
  res.json({ mandate });
};
