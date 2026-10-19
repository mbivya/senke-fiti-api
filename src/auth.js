// src/auth.js
import crypto from 'crypto';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return `pbkdf2:${salt}:${hash}`;
}

export async function verifyPassword(password, stored) {
  const [algo, salt, hash] = stored.split(':');
  if (algo !== 'pbkdf2') return false;
  const computed = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return computed === hash;
}

export function generateId(prefix = '') {
  const id = crypto.randomBytes(16).toString('hex');
  return prefix ? `${prefix}_${id}` : id;
}

export function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return '254' + digits.slice(1);
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^[17]\d{8}$/.test(digits)) return '254' + digits;
  return null;
}

export function getCookie(cookieString, name) {
  if (!cookieString) return null;
  const match = cookieString.match(new RegExp('(^|; )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

export function buildSessionCookie(token) {
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=315360000`;
}

export function buildLogoutCookie() {
  return `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}