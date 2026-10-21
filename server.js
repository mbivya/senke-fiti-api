// server.js
import express from 'express';
import dotenv from 'dotenv';
import pkg from 'pg';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

import { activateListing, searchListings, getUserListings, getListing } from './src/listings.js';
import { hashPassword, verifyPassword, generateId, normalizePhone, getCookie, buildSessionCookie, buildLogoutCookie } from './src/auth.js';
import { initiateStkPush, checkKopoKopoStatus } from './src/payments.js';
import { expireStaleListings, deleteOldListings } from './src/cron.js';
import { 
  listReports, listVerifications, approveVerification, rejectVerification, 
  listAllListings, listAllUsers, searchListingsAdmin, searchUsersAdmin, 
  updateUserStatus, updateUserRole 
} from './src/admin.js';

dotenv.config();

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Cron Job
setInterval(async () => {
  try {
    const expired = await expireStaleListings(pool);
    const deleted = await deleteOldListings(pool);
    console.log(`Cron: Expired ${expired} listings. Deleted ${deleted.drafts} drafts and ${deleted.expired} expired listings.`);
  } catch (err) {
    console.error('Cron job failed:', err);
  }
}, 24 * 60 * 60 * 1000);

async function uploadToSupabase(filePath, fileBuffer, mimetype) {
  const { data, error } = await supabase.storage.from('senke-fiti').upload(filePath, fileBuffer, { contentType: mimetype });
  if (error) throw new Error(error.message);
  return data;
}

function generateOrderNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(1000 + Math.random() * 9000);
  return `SF-${date}-${random}`;
}

// --- AUTH ROUTES ---
app.post('/api/signup', async (req, res) => {
  const { phone, password, full_name } = req.body;
  if (!phone || !password || !full_name) return res.status(400).json({ error: 'All fields required.' });
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return res.status(400).json({ error: 'Invalid Kenyan phone number.' });

  try {
    const existing = await pool.query('SELECT id FROM users WHERE phone = $1', [normalizedPhone]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Phone already registered.' });

    const userId = generateId('user');
    const passwordHash = await hashPassword(password);
    await pool.query('INSERT INTO users (id, phone, password_hash, full_name) VALUES ($1, $2, $3, $4)', [userId, normalizedPhone, passwordHash, full_name.trim()]);

    const token = generateId('sess');
    await pool.query('INSERT INTO sessions (id, user_id, token) VALUES ($1, $2, $3)', [generateId('sess'), userId, token]);

    res.setHeader('Set-Cookie', buildSessionCookie(token));
    res.status(201).json({ ok: true, user: { id: userId, phone: normalizedPhone, full_name: full_name.trim() } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'Phone and password required.' });
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return res.status(400).json({ error: 'Invalid phone number.' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [normalizedPhone]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid phone or password.' });
    if (user.status && user.status !== 'active') return res.status(403).json({ error: 'Account suspended/banned.' });
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid phone or password.' });

    const token = generateId('sess');
    await pool.query('INSERT INTO sessions (id, user_id, token) VALUES ($1, $2, $3)', [generateId('sess'), user.id, token]);
    res.setHeader('Set-Cookie', buildSessionCookie(token));
    res.json({ ok: true, user: { id: user.id, phone: user.phone, full_name: user.full_name, role: user.role } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/forgot-password', async (req, res) => {
  const { phone } = req.body;
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return res.status(400).json({ error: 'Invalid phone number.' });

  try {
    const result = await pool.query('SELECT id, full_name FROM users WHERE phone = $1', [normalizedPhone]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'No account found with that number.' });

    const tempPin = Math.floor(100000 + Math.random() * 900000).toString();
    const newHash = await hashPassword(tempPin);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);

    res.json({ ok: true, message: `Password reset. Your temporary PIN is: ${tempPin}. Please log in and change it.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/me', async (req, res) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(401).json({ user: null });
  try {
    const result = await pool.query(`SELECT u.id, u.phone, u.full_name, u.role, u.is_verified, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`, [token]);
    if (result.rows.length === 0) return res.status(401).json({ user: null });
    res.json({ user: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/logout', async (req, res) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]).catch(() => {});
  res.setHeader('Set-Cookie', buildLogoutCookie());
  res.json({ ok: true });
});

// --- NOTIFICATIONS ROUTE ---
app.get('/api/notifications', async (req, res) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const userRes = await pool.query('SELECT user_id FROM sessions WHERE token = $1', [token]);
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
    const notifs = await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC', [userRes.rows[0].user_id]);
    res.json({ notifications: notifs.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- LISTING ROUTES ---
app.get('/api/listings', async (req, res) => {
  try { res.json({ listings: await searchListings(pool, req.query) }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/listings/mine', async (req, res) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const userRes = await pool.query('SELECT user_id FROM sessions WHERE token = $1', [token]);
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
    const listings = await getUserListings(pool, userRes.rows[0].user_id);
    res.json({ listings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/listings/delete-drafts', async (req, res) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const userRes = await pool.query('SELECT user_id FROM sessions WHERE token = $1', [token]);
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
    await pool.query("DELETE FROM listings WHERE user_id = $1 AND status = 'draft'", [userRes.rows[0].user_id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/listings/:id', async (req, res) => {
  try {
    const listing = await getListing(pool, req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (listing.status !== 'active') {
      const token = getCookie(req.headers.cookie, 'session');
      if (!token) return res.status(403).json({ error: 'This listing is not public yet.' });
      const userRes = await pool.query('SELECT user_id FROM sessions WHERE token = $1', [token]);
      if (userRes.rows.length === 0 || listing.user_id !== userRes.rows[0].user_id) {
         return res.status(403).json({ error: 'This listing is not public yet.' });
      }
    }
    res.json({ listing });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/listings/:id/delete', async (req, res) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const userRes = await pool.query('SELECT user_id FROM sessions WHERE token = $1', [token]);
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
    const listingId = req.params.id;
    const listingRes = await pool.query('SELECT user_id FROM listings WHERE id = $1', [listingId]);
    if (listingRes.rows.length === 0 || listingRes.rows[0].user_id !== userRes.rows[0].user_id) return res.status(403).json({ error: 'Not your listing.' });

    const imagesRes = await pool.query('SELECT r2_key FROM listing_images WHERE listing_id = $1', [listingId]);
    const docsRes = await pool.query('SELECT r2_key FROM listing_documents WHERE listing_id = $1', [listingId]);
    const filesToDelete = [...imagesRes.rows.map(r => r.r2_key), ...docsRes.rows.map(r => r.r2_key)];
    if (filesToDelete.length > 0) await supabase.storage.from('senke-fiti').remove(filesToDelete);
    
    await pool.query('DELETE FROM listings WHERE id = $1', [listingId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/listings', upload.fields([{ name: 'photos', maxCount: 10 }, { name: 'documents', maxCount: 5 }]), async (req, res) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const userRes = await pool.query('SELECT user_id FROM sessions WHERE token = $1', [token]);
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
    const userId = userRes.rows[0].user_id;
    const { make, model, price_kes, condition, location_town, year, engine_cc, mileage_km, intended_use, location_county, description, logbook_status } = req.body;
    if (!make || !model || !price_kes || !condition || !location_town) return res.status(400).json({ error: 'Missing required fields.' });

    const listingId = generateId('listing');
    await pool.query(`INSERT INTO listings (id, user_id, make, model, year, engine_cc, mileage_km, price_kes, condition, intended_use, location_town, location_county, description, logbook_status, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'draft')`, [listingId, userId, make, model, year || null, engine_cc || null, mileage_km || null, price_kes, condition, intended_use || null, location_town, location_county || null, description || null, logbook_status || null]);

    if (req.files && req.files.photos) {
      for (let i = 0; i < req.files.photos.length; i++) {
        const file = req.files.photos[i];
        const fileName = `listings/${listingId}/photos/${generateId()}.${file.originalname.split('.').pop()}`;
        await uploadToSupabase(fileName, file.buffer, file.mimetype);
        await pool.query(`INSERT INTO listing_images (id, listing_id, r2_key, sort_order) VALUES ($1, $2, $3, $4)`, [generateId('img'), listingId, fileName, i]);
      }
    }
    if (req.files && req.files.documents) {
      for (const file of req.files.documents) {
        const fileName = `listings/${listingId}/documents/${generateId()}.${file.originalname.split('.').pop()}`;
        await uploadToSupabase(fileName, file.buffer, file.mimetype);
        await pool.query(`INSERT INTO listing_documents (id, listing_id, r2_key, doc_type) VALUES ($1, $2, $3, $4)`, [generateId('doc'), listingId, fileName, 'logbook']);
      }
    }
    res.status(201).json({ ok: true, listing_id: listingId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/listings/:id', upload.fields([{ name: 'photos', maxCount: 10 }, { name: 'documents', maxCount: 5 }]), async (req, res) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const userRes = await pool.query('SELECT user_id FROM sessions WHERE token = $1', [token]);
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
    const listingId = req.params.id;
    const listingRes = await pool.query('SELECT user_id FROM listings WHERE id = $1', [listingId]);
    if (listingRes.rows.length === 0 || listingRes.rows[0].user_id !== userRes.rows[0].user_id) return res.status(403).json({ error: 'Not your listing.' });

    const { make, model, price_kes, condition, location_town, year, engine_cc, mileage_km, intended_use, location_county, description, logbook_status } = req.body;
    await pool.query(`UPDATE listings SET make = $1, model = $2, year = $3, engine_cc = $4, mileage_km = $5, price_kes = $6, condition = $7, intended_use = $8, location_town = $9, location_county = $10, description = $11, logbook_status = $12, updated_at = now() WHERE id = $13`, [make, model, year || null, engine_cc || null, mileage_km || null, price_kes, condition, intended_use || null, location_town, location_county || null, description || null, logbook_status || null, listingId]);

    if (req.files && req.files.photos && req.files.photos.length > 0) {
      const maxOrderRes = await pool.query('SELECT MAX(sort_order) as max FROM listing_images WHERE listing_id = $1', [listingId]);
      let startOrder = (maxOrderRes.rows[0].max || 0) + 1;
      for (let i = 0; i < req.files.photos.length; i++) {
        const file = req.files.photos[i];
        const fileName = `listings/${listingId}/photos/${generateId()}.${file.originalname.split('.').pop()}`;
        await uploadToSupabase(fileName, file.buffer, file.mimetype);
        await pool.query(`INSERT INTO listing_images (id, listing_id, r2_key, sort_order) VALUES ($1, $2, $3, $4)`, [generateId('img'), listingId, fileName, startOrder + i]);
      }
    }
    if (req.files && req.files.documents && req.files.documents.length > 0) {
      for (const file of req.files.documents) {
        const fileName = `listings/${listingId}/documents/${generateId()}.${file.originalname.split('.').pop()}`;
        await uploadToSupabase(fileName, file.buffer, file.mimetype);
        await pool.query(`INSERT INTO listing_documents (id, listing_id, r2_key, doc_type) VALUES ($1, $2, $3, $4)`, [generateId('doc'), listingId, fileName, 'logbook']);
      }
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ADMIN ROUTES ---
app.use('/api/admin', async (req, res, next) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(403).json({ error: 'Forbidden' });
  const userRes = await pool.query(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`, [token]);
  const adminUser = userRes.rows[0];
  if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'super_admin')) return res.status(403).json({ error: 'Forbidden' });
  req.adminUser = adminUser;
  next();
});

// NEW: Admin Overview Stats Route
app.get('/api/admin/stats', async (req, res) => {
  try {
    // 1. Total Revenue (Successful payments only)
    const revRes = await pool.query("SELECT SUM(amount_kes) as total FROM payments WHERE status = 'success'");
    const totalRevenue = revRes.rows[0].total || 0;

    // 2. Total Users
    const userRes = await pool.query("SELECT COUNT(*) as count FROM users");
    const totalUsers = parseInt(userRes.rows[0].count);

    // 3. Total Listings
    const listRes = await pool.query("SELECT COUNT(*) as count FROM listings");
    const totalListings = parseInt(listRes.rows[0].count);

    // 4. Pending Actions (Reports + Verifications)
    const repRes = await pool.query("SELECT COUNT(*) as count FROM reports WHERE status = 'open'");
    const verRes = await pool.query("SELECT COUNT(*) as count FROM sellers_verification WHERE status = 'pending'");
    const pendingActions = parseInt(repRes.rows[0].count) + parseInt(verRes.rows[0].count);

    // 5. Recent Transactions
    const recentPayRes = await pool.query(`
      SELECT p.amount_kes, p.purpose, p.mpesa_receipt, p.created_at, u.full_name
      FROM payments p JOIN users u ON u.id = p.user_id
      WHERE p.status = 'success'
      ORDER BY p.created_at DESC LIMIT 5
    `);

    // 6. Recent Signups
    const recentUserRes = await pool.query(`
      SELECT full_name, phone, created_at
      FROM users
      ORDER BY created_at DESC LIMIT 5
    `);

    res.json({
      totalRevenue,
      totalUsers,
      totalListings,
      pendingActions,
      recentTransactions: recentPayRes.rows,
      recentSignups: recentUserRes.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/reports', async (req, res) => { try { res.json({ reports: await listReports(pool) }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/admin/reports/:id/dismiss', async (req, res) => { try { await pool.query("UPDATE reports SET status = 'dismissed' WHERE id = $1", [req.params.id]); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/admin/verifications', async (req, res) => { try { res.json({ verifications: await listVerifications(pool) }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/admin/verifications/:id/approve', async (req, res) => { try { await approveVerification(pool, req.params.id, req.adminUser.id); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/admin/verifications/:id/reject', async (req, res) => { try { await rejectVerification(pool, req.params.id, req.adminUser.id, 'Rejected by admin'); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/admin/listings', async (req, res) => { try { const listings = req.query.q ? await searchListingsAdmin(pool, req.query.q) : await listAllListings(pool); res.json({ listings }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/admin/listings/:id/approve', async (req, res) => { try { await activateListing(pool, req.params.id, 12); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/admin/listings/:id/suspend', async (req, res) => { try { await pool.query("UPDATE listings SET status = 'hidden', updated_at = now() WHERE id = $1", [req.params.id]); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); } });

app.post('/api/admin/listings/:id/delete', async (req, res) => {
  try {
    const listingId = req.params.id;
    const imagesRes = await pool.query('SELECT r2_key FROM listing_images WHERE listing_id = $1', [listingId]);
    const docsRes = await pool.query('SELECT r2_key FROM listing_documents WHERE listing_id = $1', [listingId]);
    const filesToDelete = [...imagesRes.rows.map(r => r.r2_key), ...docsRes.rows.map(r => r.r2_key)];
    if (filesToDelete.length > 0) await supabase.storage.from('senke-fiti').remove(filesToDelete);
    
    const listingRes = await pool.query('SELECT user_id FROM listings WHERE id = $1', [listingId]);
    const sellerId = listingRes.rows[0]?.user_id;

    await pool.query('DELETE FROM listings WHERE id = $1', [listingId]);
    
    if (sellerId) {
      await pool.query(
        'INSERT INTO notifications (id, user_id, title, message) VALUES ($1, $2, $3, $4)',
        [generateId('notif'), sellerId, 'Listing Deleted', `Your listing was removed by an admin. Please contact support for clarification.`]
      );
    }
    res.json({ ok: true });
  } catch (err) { 
    console.error('Admin delete error:', err);
    res.status(500).json({ error: err.message }); 
  }
});

app.get('/api/admin/users', async (req, res) => { try { const users = req.query.q ? await searchUsersAdmin(pool, req.query.q) : await listAllUsers(pool); res.json({ users }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/admin/users/:id/status', async (req, res) => { try { await updateUserStatus(pool, req.params.id, req.body.status, req.adminUser); res.json({ ok: true }); } catch (err) { res.status(400).json({ error: err.message }); } });
app.post('/api/admin/users/:id/role', async (req, res) => { try { await updateUserRole(pool, req.params.id, req.body.role, req.adminUser); res.json({ ok: true }); } catch (err) { res.status(400).json({ error: err.message }); } });

// --- PAYMENT ROUTES ---
app.post('/api/payments/initiate', async (req, res) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  const { listing_id, purpose } = req.body;
  
  try {
    const userRes = await pool.query('SELECT u.id, u.phone, u.full_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1', [token]);
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
    const user = userRes.rows[0];

    const PRICES = { standard_listing: 300, featured_listing: 1000, verified_badge: 500, renewal: 300 };
    const amount = PRICES[purpose];
    if (!amount) return res.status(400).json({ error: 'Unknown purpose.' });

    const callbackUrl = `https://${req.get('host')}/api/payments/webhook`;
    const firstName = user.full_name ? user.full_name.split(' ')[0] : 'Senke';
    const lastName = user.full_name && user.full_name.split(' ').length > 1 ? user.full_name.split(' ')[1] : 'Fiti';

    const result = await initiateStkPush({ 
      phone: user.phone, 
      amount, 
      callbackUrl, 
      metadata: { first_name: firstName, last_name: lastName, listing_id, purpose } 
    });

    if (result.id) {
      const orderNumber = generateOrderNumber();
      const orderToken = crypto.randomBytes(16).toString('hex');

      await pool.query(
        'INSERT INTO payments (id, user_id, listing_id, purpose, amount_kes, phone, checkout_id, status, order_number, order_token) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [generateId('pay'), user.id, listing_id || null, purpose, amount, user.phone, result.id, 'pending', orderNumber, orderToken]
      );
    }

    res.json({ ok: true, message: 'STK push sent!', result });
  } catch (err) {
    console.error("KopoKopo Init Error:", err);
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/receipt/:orderNumber/:token', async (req, res) => {
  try {
    const { orderNumber, token } = req.params;
    const result = await pool.query(`
      SELECT p.*, u.full_name, l.make, l.model 
      FROM payments p 
      LEFT JOIN users u ON u.id = p.user_id 
      LEFT JOIN listings l ON l.id = p.listing_id
      WHERE p.order_number = $1 AND p.order_token = $2
    `, [orderNumber, token]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Receipt not found.' });
    res.json({ receipt: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payments/verify', async (req, res) => {
  const { listing_id } = req.body;
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  try {
    const payRes = await pool.query(
      "SELECT checkout_id FROM payments WHERE listing_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
      [listing_id]
    );

    if (payRes.rows.length === 0) return res.json({ status: 'no_pending' });

    const checkoutId = payRes.rows[0].checkout_id;
    if (!checkoutId) return res.json({ status: 'no_pending' });

    const kopoData = await checkKopoKopoStatus(checkoutId);
    if (!kopoData) return res.json({ status: 'error' });

    const status = String(kopoData?.data?.attributes?.status || kopoData?.status || '').toLowerCase();
    const isSuccess = status === 'success' || status === 'complete';

    if (isSuccess) {
      await activateListing(pool, listing_id, 12);
      await pool.query("UPDATE payments SET status = 'success' WHERE checkout_id = $1", [checkoutId]);
      return res.json({ status: 'success' });
    }

    return res.json({ status: 'pending' });
  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payments/webhook', async (req, res) => {
  console.log('Webhook received:', req.body);
  try {
    const payload = req.body;
    const attrs = payload?.data?.attributes || payload;
    const status = attrs?.status;
    const metadata = attrs?.metadata || payload?.metadata || {};
    const listingId = metadata?.listing_id;
    const purpose = metadata?.purpose;
    const mpesaReceipt = attrs?.transaction_reference || attrs?.receipt_number || null;

    const isSuccess = String(status).toLowerCase() === 'success' || String(status).toLowerCase() === 'complete';

    if (isSuccess) {
      await pool.query(
        `UPDATE payments 
         SET status = 'success', mpesa_receipt = $1, updated_at = now() 
         WHERE purpose = $2 AND status = 'pending' 
         ORDER BY created_at DESC LIMIT 1`,
        [mpesaReceipt, purpose]
      );

      if (purpose === 'standard_listing' && listingId) {
        await activateListing(pool, listingId, 12);
      } 
      else if (purpose === 'featured_listing' && listingId) {
        await activateListing(pool, listingId, 12);
        await pool.query("UPDATE listings SET is_featured = true, featured_until = now() + interval '30 days' WHERE id = $1", [listingId]);
      }
      else if (purpose === 'renewal' && listingId) {
        await pool.query("UPDATE listings SET status = 'active', expires_at = now() + interval '12 months', updated_at = now() WHERE id = $1", [listingId]);
      }
      else if (purpose === 'verified_badge') {
        const userId = metadata?.user_id || (await pool.query("SELECT user_id FROM payments WHERE purpose = 'verified_badge' AND status = 'pending' ORDER BY created_at DESC LIMIT 1")).rows[0]?.user_id;
        if (userId) {
           await pool.query("UPDATE users SET is_verified = true WHERE id = $1", [userId]);
        }
      }
    }
    res.json({ ok: true, processed: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Senke Fiti Backend running on port ${port}`);
});