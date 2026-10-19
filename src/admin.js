// ============================================
// ADMIN — reports, verification, user management, search
// ============================================

import { hideListing, restoreListing } from './listings.js';

// ---------- REPORTS ----------

export async function listReports(env) {
  const rows = await env.DB.prepare(`
    SELECT r.id, r.listing_id, r.reason, r.details, r.status, r.created_at,
           l.make, l.model, l.status AS listing_status
    FROM reports r
    LEFT JOIN listings l ON l.id = r.listing_id
    WHERE r.status = 'open'
    ORDER BY r.created_at DESC
    LIMIT 100
  `).all();
  return rows.results;
}

export async function hideReportedListing(env, listingId, adminId) {
  await hideListing(env, listingId);
  await env.DB.prepare(`
    UPDATE reports
    SET status = 'actioned', action_taken = 'listing_hidden',
        reviewed_by = ?, reviewed_at = datetime('now')
    WHERE listing_id = ? AND status = 'open'
  `).bind(adminId, listingId).run();
}

export async function dismissReport(env, reportId, adminId) {
  const report = await env.DB.prepare(
    'SELECT listing_id FROM reports WHERE id = ?'
  ).bind(reportId).first();

  await env.DB.prepare(`
    UPDATE reports
    SET status = 'dismissed', action_taken = 'listing_restored',
        reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).bind(adminId, reportId).run();

  if (report?.listing_id) {
    await restoreListing(env, report.listing_id);
  }
}

export async function restoreReportedListing(env, listingId, adminId) {
  await restoreListing(env, listingId);
  await env.DB.prepare(`
    UPDATE reports
    SET status = 'dismissed', action_taken = 'listing_restored',
        reviewed_by = ?, reviewed_at = datetime('now')
    WHERE listing_id = ? AND status = 'actioned'
  `).bind(adminId, listingId).run();
}

// ---------- VERIFICATIONS ----------

export async function listVerifications(env) {
  const rows = await env.DB.prepare(`
    SELECT v.id, v.user_id, v.business_name, v.business_location,
           v.business_phone, v.id_number, v.status, v.created_at,
           u.full_name AS applicant_name, u.phone AS applicant_phone
    FROM sellers_verification v
    JOIN users u ON u.id = v.user_id
    WHERE v.status = 'pending'
    ORDER BY v.created_at DESC
    LIMIT 100
  `).all();
  return rows.results;
}

export async function approveVerification(env, verificationId, adminId) {
  const v = await env.DB.prepare(
    'SELECT user_id FROM sellers_verification WHERE id = ?'
  ).bind(verificationId).first();

  if (!v) throw new Error('Verification request not found.');

  await env.DB.prepare(`
    UPDATE sellers_verification
    SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).bind(adminId, verificationId).run();

  await env.DB.prepare(
    'UPDATE users SET is_verified = 1 WHERE id = ?'
  ).bind(v.user_id).run();
}

export async function rejectVerification(env, verificationId, adminId, reason) {
  await env.DB.prepare(`
    UPDATE sellers_verification
    SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).bind(reason || 'Rejected by admin', adminId, verificationId).run();
}

// ---------- LISTINGS LIST + SEARCH ----------

export async function listAllListings(env, limit = 100) {
  const rows = await env.DB.prepare(`
    SELECT l.id, l.make, l.model, l.price_kes, l.status, l.is_paid, l.created_at,
           u.full_name AS seller_name, u.phone AS seller_phone
    FROM listings l
    JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC
    LIMIT ?
  `).bind(limit).all();
  return rows.results;
}

export async function searchListingsAdmin(env, q) {
  const like = '%' + (q || '') + '%';
  const rows = await env.DB.prepare(`
    SELECT l.id, l.make, l.model, l.price_kes, l.status, l.is_paid, l.created_at,
           u.full_name AS seller_name, u.phone AS seller_phone
    FROM listings l
    JOIN users u ON u.id = l.user_id
    WHERE l.make LIKE ? OR l.model LIKE ? OR u.full_name LIKE ? OR u.phone LIKE ?
    ORDER BY l.created_at DESC
    LIMIT 100
  `).bind(like, like, like, like).all();
  return rows.results;
}

// ---------- USERS LIST + SEARCH ----------

export async function listAllUsers(env, limit = 100) {
  const rows = await env.DB.prepare(`
    SELECT id, phone, full_name, role, is_verified, status, created_at
    FROM users
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(limit).all();
  return rows.results;
}

export async function searchUsersAdmin(env, q) {
  const like = '%' + (q || '') + '%';
  const rows = await env.DB.prepare(`
    SELECT id, phone, full_name, role, is_verified, status, created_at
    FROM users
    WHERE full_name LIKE ? OR phone LIKE ?
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(like, like).all();
  return rows.results;
}

// ---------- USER MANAGEMENT ----------

export async function updateUserStatus(env, targetUserId, newStatus, adminUser) {
  if (!['active', 'suspended', 'banned'].includes(newStatus)) {
    throw new Error('Invalid status.');
  }

  const target = await env.DB.prepare(
    'SELECT id, role FROM users WHERE id = ?'
  ).bind(targetUserId).first();

  if (!target) throw new Error('User not found.');
  if (target.id === adminUser.id) throw new Error('You cannot change your own status.');

  // Only super_admin can modify admin or super_admin accounts
  if ((target.role === 'admin' || target.role === 'super_admin') && adminUser.role !== 'super_admin') {
    throw new Error('Only super admin can modify admin accounts.');
  }

  await env.DB.prepare(
    "UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(newStatus, targetUserId).run();

  if (newStatus !== 'active') {
    // Hide all their listings and kill their sessions
    await env.DB.prepare(
      "UPDATE listings SET status = 'hidden', updated_at = datetime('now') WHERE user_id = ?"
    ).bind(targetUserId).run();

    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetUserId).run();
  }
}

export async function updateUserRole(env, targetUserId, newRole, adminUser) {
  if (!['user', 'admin', 'super_admin'].includes(newRole)) {
    throw new Error('Invalid role.');
  }

  if (adminUser.role !== 'super_admin') {
    throw new Error('Only super admin can change roles.');
  }

  const target = await env.DB.prepare(
    'SELECT id, role FROM users WHERE id = ?'
  ).bind(targetUserId).first();

  if (!target) throw new Error('User not found.');
  if (target.id === adminUser.id) throw new Error('You cannot change your own role.');

  await env.DB.prepare(
    "UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(newRole, targetUserId).run();
}

// ---------- LEGACY ----------

export async function promoteToAdmin(env, userId) {
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(userId).run();
}