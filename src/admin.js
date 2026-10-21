// src/admin.js

export async function listReports(pool) {
  const result = await pool.query(`
    SELECT r.id, r.listing_id, r.reason, r.details, r.status, r.created_at,
           l.make, l.model, l.status AS listing_status
    FROM reports r
    LEFT JOIN listings l ON l.id = r.listing_id
    WHERE r.status = 'open'
    ORDER BY r.created_at DESC
    LIMIT 100
  `);
  return result.rows;
}

export async function listVerifications(pool) {
  const result = await pool.query(`
    SELECT v.id, v.user_id, v.business_name, v.business_location,
           v.business_phone, v.id_number, v.status, v.created_at,
           u.full_name AS applicant_name, u.phone AS applicant_phone
    FROM sellers_verification v
    JOIN users u ON u.id = v.user_id
    WHERE v.status = 'pending'
    ORDER BY v.created_at DESC
    LIMIT 100
  `);
  return result.rows;
}

export async function approveVerification(pool, verificationId, adminId) {
  const vRes = await pool.query('SELECT user_id FROM sellers_verification WHERE id = $1', [verificationId]);
  if (vRes.rows.length === 0) throw new Error('Verification request not found.');

  await pool.query(`
    UPDATE sellers_verification
    SET status = 'approved', reviewed_by = $1, reviewed_at = now()
    WHERE id = $2
  `, [adminId, verificationId]);

  await pool.query('UPDATE users SET is_verified = true WHERE id = $1', [vRes.rows[0].user_id]);
}

export async function rejectVerification(pool, verificationId, adminId, reason) {
  await pool.query(`
    UPDATE sellers_verification
    SET status = 'rejected', review_note = $1, reviewed_by = $2, reviewed_at = now()
    WHERE id = $3
  `, [reason || 'Rejected by admin', adminId, verificationId]);
}

export async function listAllListings(pool, limit = 100) {
  // MODIFIED: Added l.is_featured to the SELECT
  const result = await pool.query(`
    SELECT l.id, l.make, l.model, l.price_kes, l.status, l.is_paid, l.is_featured, l.created_at,
           u.full_name AS seller_name, u.phone AS seller_phone
    FROM listings l
    JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

export async function searchListingsAdmin(pool, q) {
  const like = '%' + (q || '') + '%';
  // MODIFIED: Added l.is_featured to the SELECT
  const result = await pool.query(`
    SELECT l.id, l.make, l.model, l.price_kes, l.status, l.is_paid, l.is_featured, l.created_at,
           u.full_name AS seller_name, u.phone AS seller_phone
    FROM listings l
    JOIN users u ON u.id = l.user_id
    WHERE l.make ILIKE $1 OR l.model ILIKE $1 OR u.full_name ILIKE $1 OR u.phone ILIKE $1
    ORDER BY l.created_at DESC
    LIMIT 100
  `, [like]);
  return result.rows;
}

export async function listAllUsers(pool, limit = 100) {
  const result = await pool.query(`
    SELECT id, phone, full_name, role, is_verified, status, created_at
    FROM users
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

export async function searchUsersAdmin(pool, q) {
  const like = '%' + (q || '') + '%';
  const result = await pool.query(`
    SELECT id, phone, full_name, role, is_verified, status, created_at
    FROM users
    WHERE full_name ILIKE $1 OR phone ILIKE $1
    ORDER BY created_at DESC
    LIMIT 100
  `, [like]);
  return result.rows;
}

export async function updateUserStatus(pool, targetUserId, newStatus, adminUser) {
  if (!['active', 'suspended', 'banned'].includes(newStatus)) throw new Error('Invalid status.');
  
  const targetRes = await pool.query('SELECT id, role FROM users WHERE id = $1', [targetUserId]);
  const target = targetRes.rows[0];
  
  if (!target) throw new Error('User not found.');
  if (target.id === adminUser.id) throw new Error('You cannot change your own status.');
  if ((target.role === 'admin' || target.role === 'super_admin') && adminUser.role !== 'super_admin') {
    throw new Error('Only super admin can modify admin accounts.');
  }

  await pool.query("UPDATE users SET status = $1, updated_at = now() WHERE id = $2", [newStatus, targetUserId]);

  if (newStatus !== 'active') {
    await pool.query("UPDATE listings SET status = 'hidden', updated_at = now() WHERE user_id = $1", [targetUserId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [targetUserId]);
  }
}

export async function updateUserRole(pool, targetUserId, newRole, adminUser) {
  if (!['user', 'admin', 'super_admin'].includes(newRole)) throw new Error('Invalid role.');
  if (adminUser.role !== 'super_admin') throw new Error('Only super admin can change roles.');

  const targetRes = await pool.query('SELECT id, role FROM users WHERE id = $1', [targetUserId]);
  const target = targetRes.rows[0];
  
  if (!target) throw new Error('User not found.');
  if (target.id === adminUser.id) throw new Error('You cannot change your own role.');

  await pool.query("UPDATE users SET role = $1, updated_at = now() WHERE id = $2", [newRole, targetUserId]);
}