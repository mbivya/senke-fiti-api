// server.js
import express from 'express';
import dotenv from 'dotenv';
import pkg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

// Import your logic files
import { hashPassword, verifyPassword, generateId, normalizePhone, getCookie, buildSessionCookie, buildLogoutCookie } from './src/auth.js';
import { searchListings, getUserListings, getListing } from './src/listings.js';
import { initiateStkPush, verifyWebhookSignature } from './src/payments.js';

dotenv.config();

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// 1. SETUP SUPABASE CONNECTION
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(path.join(__dirname, 'public/media')));

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
  if (token) {
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]).catch(() => {});
  }
  res.setHeader('Set-Cookie', buildLogoutCookie());
  res.json({ ok: true });
});

// --- LISTING ROUTES ---

app.get('/api/listings', async (req, res) => {
  try {
    const listings = await searchListings(pool, req.query);
    res.json({ listings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/listings/mine', async (req, res) => {
  const token = getCookie(req.headers.cookie, 'session');
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  try {
    const userRes = await pool.query('SELECT user_id FROM sessions WHERE token = $1', [token]);
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
    
    const listings = await getUserListings(pool, userRes.rows[0].user_id);
    res.json({ listings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/listings/:id', async (req, res) => {
  try {
    const listing = await getListing(pool, req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    res.json({ listing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PAYMENT ROUTES ---

app.post('/api/payments/initiate', async (req, res) => {
  const { listing_id, purpose } = req.body;
  
  // This is currently hardcoded. Once KopoKopo is unblocked, we will replace this with the logged-in user's phone number.
  const phone = '254712345678'; 

  const PRICES = { standard_listing: 300, featured_listing: 1000, verified_badge: 500 };
  const amount = PRICES[purpose];
  if (!amount) return res.status(400).json({ error: 'Unknown purpose.' });

  const callbackUrl = `${req.protocol}://${req.get('host')}/api/payments/webhook`;

  try {
    const result = await initiateStkPush({
      phone,
      amount,
      callbackUrl,
      metadata: { first_name: 'Test', last_name: 'User', listing_id, purpose }
    });

    res.json({ ok: true, message: 'STK push sent!', result });
  } catch (err) {
    console.error("=== KOPOKOPO ERROR ===");
    console.error(err.message);
    console.error("======================");
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
