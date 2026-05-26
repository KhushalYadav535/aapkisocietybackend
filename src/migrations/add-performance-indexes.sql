-- Performance Indexes for AapkiSociety Platform
-- Run this to significantly speed up dashboard queries
-- Expected improvement: 3-5x faster on large datasets

-- ─── Complaints Table Indexes ──────────────────────────────────────
-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);

-- Index for filtering by raised_by (user complaints)
CREATE INDEX IF NOT EXISTS idx_complaints_raised_by ON complaints(raised_by);

-- Composite index for common dashboard queries
CREATE INDEX IF NOT EXISTS idx_complaints_status_created ON complaints(status, created_at DESC);

-- ─── Payments Table Indexes ───────────────────────────────────────
-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- Index for filtering by member_id
CREATE INDEX IF NOT EXISTS idx_payments_member_id ON payments(member_id);

-- Composite index for collection queries
CREATE INDEX IF NOT EXISTS idx_payments_status_date ON payments(status, payment_date DESC);

-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments(payment_date DESC);

-- ─── Bills Table Indexes ──────────────────────────────────────────
-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);

-- Index for filtering by member_id
CREATE INDEX IF NOT EXISTS idx_bills_member_id ON bills(member_id);

-- Composite index for pending bills dashboard queries
CREATE INDEX IF NOT EXISTS idx_bills_status_member ON bills(status, member_id);

-- ─── Visitors Table Indexes ───────────────────────────────────────
-- Index for check_in date filtering
CREATE INDEX IF NOT EXISTS idx_visitors_check_in_date ON visitors(DATE(check_in));

-- ─── Notices Table Indexes ────────────────────────────────────────
-- Index for published notices
CREATE INDEX IF NOT EXISTS idx_notices_published ON notices(is_published);

-- Composite index for recent notices
CREATE INDEX IF NOT EXISTS idx_notices_published_date ON notices(is_published, publish_date DESC);

-- ─── Users Table Indexes ──────────────────────────────────────────
-- Index for active users filtering
CREATE INDEX IF NOT EXISTS idx_users_is_active ON platform.users(is_active);

-- ─── Platform Societies Indexes ───────────────────────────────────
-- Indexes for renewal queries
CREATE INDEX IF NOT EXISTS idx_societies_subscription_renewal ON platform.societies(subscription_status, renewal_date);

-- Composite index for status filtering
CREATE INDEX IF NOT EXISTS idx_societies_status ON platform.societies(subscription_status);

-- ─── Flats Table Indexes ──────────────────────────────────────────
-- Index for society flats
CREATE INDEX IF NOT EXISTS idx_flats_society_id ON platform.flats(society_id);
