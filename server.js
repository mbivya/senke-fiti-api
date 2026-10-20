// server.js
import express from 'express';
import dotenv from 'dotenv';
import pkg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

import { hashPassword, verifyPassword, generateId, normalizePhone, getCookie, buildSessionCookie, buildLogoutCookie } from './src/auth.js';
import { searchListings, getUserListings, getListing } from './src/listings.js';
import { initiateStkPush, verifyWebhookSignature } from './src/payments.js';
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

// Initialize S3 Client for Supabase Storage
const s3Client = new S3Client({
  region: process.env.S3_REGION || 'eu-west-1',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  forcePathStyle: true, // Required for Supabase
});

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

// --- HELPER: Upload to Supabase via S3 ---
async function uploadToSupabase(filePath, fileBuffer, mimetype) {
  const command = new PutObjectCommand({
    Bucket: 'senke-fiti',
    Key: filePath,
    Body: fileBuffer,
    ContentType: mimetype,
  });
  
  try {
    await s3Client.send(command);
  } catch (err) {
    console.error('S3 Upload Error:', err);
    throw new Error(`S3 Upload failed: ${err.message}`);
  }
}

// --- AUTHENTICATION ROUTES ---
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

    await pool.query(
      'INSERT INTO users (id, phone, password_hash, full_name) VALUES ($1, $2, $3, $4)',
      [userId, normalizedPhone, passwordHash, full_name.trim()]
    );

    const token = generateId('sess');
    await pool.query('INSERT INTO sessions (id, user_id, token) VALUES ($1, $2, $3)', [generateId('sess'), userId, token]);

    res.setHeader('Set-Cookie', buildSessionCookie(token));
    res.status(201).json({ ok: true, user: { id: userId, phone: normalizedPhone, full_name: full_name.trim() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/me', async (req, res) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(401).json({ user: null });

  try {
    const result = await pool.query(`
      SELECT u.id, u.phone, u.full_name, u.role, u.is_verified, u.status
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = $1
    `, [token]);

    if (result.rows.length === 0) return res.status(401).json({ user: null });
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', async (req, res) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]).catch(() => {});
  res.setHeader('Set-Cookie', buildLogoutCookie());
  res.json({ ok: true });
});

// --- LISTING ROUTES ---
app.get('/api/listings', async (req, res) => {
  try {
    const listings = await searchListings(pool, req.query);
    res.json({ listings });
  } catch (err) { res.status(500).json({ error: err.message }); }
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

app.get('/api/listings/:id', async (req, res) => {
  try {
    const listing = await getListing(pool, req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    res.json({ listing });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE LISTING
app.post('/api/listings/:id/delete', async (req, res) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  try {
    const userRes = await pool.query('SELECT user_id FROM sessions WHERE token = $1', [token]);
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
    const userId = userRes.rows[0].user_id;

    const listingId = req.params.id;

    const listingRes = await pool.query('SELECT user_id FROM listings WHERE id = $1', [listingId]);
    if (listingRes.rows.length === 0) return res.status(404).json({ error: 'Listing not found.' });
    if (listingRes.rows[0].user_id !== userId) return res.status(403).json({ error: 'Not your listing.' });

    await pool.query('DELETE FROM listings WHERE id = $1', [listingId]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE NEW LISTING
app.post('/api/listings', upload.fields([{ name: 'photos', maxCount: 10 }, { name: 'documents', maxCount: 5 }]), async (req, res) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  try {
    const userRes = await pool.query('SELECT user_id FROM sessions WHERE token = $1', [token]);
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
    const userId = userRes.rows[0].user_id;

    const { make, model, price_kes, condition, location_town, year, engine_cc, mileage_km, intended_use, location_county, description, logbook_status } = req.body;
    
    if (!make || !model || !price_kes || !condition || !location_town) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const listingId = generateId('listing');
    
    await pool.query(`
      INSERT INTO listings (id, user_id, make, model, year, engine_cc, mileage_km, price_kes, condition, intended_use, location_town, location_county, description, logbook_status, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'draft')
    `, [listingId, userId, make, model, year || null, engine_cc || null, mileage_km || null, price_kes, condition, intended_use || null, location_town, location_county || null, description || null, logbook_status || null]);

    if (req.files && req.files.photos) {
      for (let i = 0; i < req.files.photos.length; i++) {
        const file = req.files.photos[i];
        const fileExt = file.originalname.split('.').pop();
        const fileName = `listings/${listingId}/photos/${generateId()}.${fileExt}`;
        
        await uploadToSupabase(fileName, file.buffer, file.mimetype);
        await pool.query(`INSERT INTO listing_images (id, listing_id, r2_key, sort_order) VALUES ($1, $2, $3, $4)`, [generateId('img'), listingId, fileName, i]);
      }
    }

    if (req.files && req.files.documents) {
      for (const file of req.files.documents) {
        const fileExt = file.originalname.split('.').pop();
        const fileName = `listings/${listingId}/documents/${generateId()}.${fileExt}`;
        
        await uploadToSupabase(fileName, file.buffer, file.mimetype);
        await pool.query(`INSERT INTO listing_documents (id, listing_id, r2_key, doc_type) VALUES ($1, $2, $3, $4)`, [generateId('doc'), listingId, fileName, 'logbook']);
      }
    }

    res.status(201).json({ ok: true, listing_id: listingId });
  } catch (err) {
    console.error('Create listing error:', err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE EXISTING LISTING
app.put('/api/listings/:id', upload.fields([{ name: 'photos', maxCount: 10 }, { name: 'documents', maxCount: 5 }]), async (req, res) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  try {
    const userRes = await pool.query('SELECT user_id FROM sessions WHERE token = $1', [token]);
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
    const userId = userRes.rows[0].user_id;

    const listingId = req.params.id;

    const listingRes = await pool.query('SELECT user_id FROM listings WHERE id = $1', [listingId]);
    if (listingRes.rows.length === 0) return res.status(404).json({ error: 'Listing not found.' });
    if (listingRes.rows[0].user_id !== userId) return res.status(403).json({ error: 'Not your listing.' });

    const { make, model, price_kes, condition, location_town, year, engine_cc, mileage_km, intended_use, location_county, description, logbook_status } = req.body;
    
    if (!make || !model || !price_kes || !condition || !location_town) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    await pool.query(`
      UPDATE listings SET
        make = $1, model = $2, year = $3, engine_cc = $4, mileage_km = $5, 
        price_kes = $6, condition = $7, intended_use = $8, location_town = $9, 
        location_county = $10, description = $11, logbook_status = $12, updated_at = now()
      WHERE id = $13
    `, [make, model, year || null, engine_cc || null, mileage_km || null, price_kes, condition, intended_use || null, location_town, location_county || null, description || null, logbook_status || null, listingId]);

    if (req.files && req.files.photos && req.files.photos.length > 0) {
      const maxOrderRes = await pool.query('SELECT MAX(sort_order) as max FROM listing_images WHERE listing_id = $1', [listingId]);
      let startOrder = (maxOrderRes.rows[0].max || 0) + 1;

      for (let i = 0; i < req.files.photos.length; i++) {
        const file = req.files.photos[i];
        const fileExt = file.originalname.split('.').pop();
        const fileName = `listings/${listingId}/photos/${generateId()}.${fileExt}`;
        
        await uploadToSupabase(fileName, file.buffer, file.mimetype);
        await pool.query(`INSERT INTO listing_images (id, listing_id, r2_key, sort_order) VALUES ($1, $2, $3, $4)`, [generateId('img'), listingId, fileName, startOrder + i]);
      }
    }

    if (req.files && req.files.documents && req.files.documents.length > 0) {
      for (const file of req.files.documents) {
        const fileExt = file.originalname.split('.').pop();
        const fileName = `listings/${listingId}/documents/${generateId()}.${fileExt}`;
        
        await uploadToSupabase(fileName, file.buffer, file.mimetype);
        await pool.query(`INSERT INTO listing_documents (id, listing_id, r2_key, doc_type) VALUES ($1, $2, $3, $4)`, [generateId('doc'), listingId, fileName, 'logbook']);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Update listing error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- ADMIN ROUTES ---
app.use('/api/admin', async (req, res, next) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(403).json({ error: 'Forbidden' });
  
  const userRes = await pool.query(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1
  `, [token]);
  
  const adminUser = userRes.rows[0];
  if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'super_admin')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  req.adminUser = adminUser;
  next();
});

app.get('/api/admin/reports', async (req, res) => {
  try { res.json({ reports: await listReports(pool) }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/reports/:id/dismiss', async (req, res) => {
  try {
    await pool.query("UPDATE reports SET status = 'dismissed' WHERE id = $1", [req.params.id]);
    const report = await pool.query("SELECT listing_id FROM reports WHERE id = $1", [req.params.id]);
    if (report.rows.length > 0 && report.rows[0].listing_id) {
       await pool.query("UPDATE listings SET status = 'active' WHERE id = $1", [report.rows[0].listing_id]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/verifications', async (req, res) => {
  try { res.json({ verifications: await listVerifications(pool) }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/verifications/:id/approve', async (req, res) => {
  try { await approveVerification(pool, req.params.id, req.adminUser.id); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/verifications/:id/reject', async (req, res) => {
  try { await rejectVerification(pool, req.params.id, req.adminUser.id, 'Rejected by admin'); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/listings', async (req, res) => {
  try {
    const listings = req.query.q ? await searchListingsAdmin(pool, req.query.q) : await listAllListings(pool);
    res.json({ listings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const users = req.query.q ? await searchUsersAdmin(pool, req.query.q) : await listAllUsers(pool);
    res.json({ users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/users/:id/status', async (req, res) => {
  try { await updateUserStatus(pool, req.params.id, req.body.status, req.adminUser); res.json({ ok: true }); } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/admin/users/:id/role', async (req, res) => {
  try { await updateUserRole(pool, req.params.id, req.body.role, req.adminUser); res.json({ ok: true }); } catch (err) { res.status(400).json({ error: err.message }); }
});

// --- PAYMENT ROUTES ---
app.post('/api/payments/initiate', async (req, res) => {
  const { listing_id, purpose } = req.body;
  const phone = '254712345678'; 
  const PRICES = { standard_listing: 300, featured_listing: 1000, verified_badge: 500 };
  const amount = PRICES[purpose];
  if (!amount) return res.status(400).json({ error: 'Unknown purpose.' });

  const callbackUrl = `${req.protocol}://${req.get('host')}/api/payments/webhook`;

  try {
    const result = await initiateStkPush({ phone, amount, callbackUrl, metadata: { first_name: 'Test', last_name: 'User', listing_id, purpose } });
    res.json({ ok: true, message: 'STK push sent!', result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/payments/webhook', async (req, res) => {
  const rawBody = JSON.stringify(req.body);
  const signature = req.headers['x-kopokopo-signature'];
  const valid = await verifyWebhookSignature(rawBody, signature);
  if (!valid) return res.status(401).json({ error: 'Invalid signature' });
  console.log('Webhook received:', req.body);
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Senke Fiti Backend running on port ${port}`);
});