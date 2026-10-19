// ============================================
// VERIFY — dealer verification apply/status
// ============================================

import { generateId } from './auth.js';

export async function getVerificationStatus(env, userId) {
  const row = await env.DB.prepare(
    `SELECT id, status, created_at FROM sellers_verification
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(userId).first();

  if (!row) return { status: 'none' };
  return { status: row.status, submitted_at: row.created_at, id: row.id };
}

export async function submitVerification(env, userId, data) {
  const business_name = String(data.business_name || '').trim();
  const business_location = String(data.business_location || '').trim();
  const business_phone = String(data.business_phone || '').trim();
  const id_number = String(data.id_number || '').trim();

  if (!business_name || !business_location || !business_phone || !id_number) {
    throw new Error('All fields are required.');
  }

  // Check for an already-pending request
  const pending = await env.DB.prepare(
    "SELECT id FROM sellers_verification WHERE user_id = ? AND status = 'pending'"
  ).bind(userId).first();

  if (pending) {
    throw new Error('You already have a pending verification request.');
  }

  const id = generateId('verif');
  await env.DB.prepare(
    `INSERT INTO sellers_verification
      (id, user_id, business_name, business_location, business_phone, id_number, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(id, userId, business_name, business_location, business_phone, id_number).run();

  return id;
}