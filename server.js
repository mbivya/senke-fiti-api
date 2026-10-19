// server.js
import express from 'express';
import dotenv from 'dotenv';
import pkg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';

// Import your logic files
import { hashPassword, verifyPassword, generateId, normalizePhone, getCookie, buildSessionCookie, buildLogoutCookie } from './src/auth.js';
import { createListing, getListing, searchListings, getUserListings } from './src/listings.js';
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
  ssl: { rejectUnauthorized: false } // Required for Supabase
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Setup multer for file uploads in memory
const upload = multer({ storage: multer.memoryStorage() });

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

    // Create session in DB
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

// --- LISTING ROUTES (Simplified for now) ---

app.get('/api/listings', async (req, res) => {
  try {
    const listings = await searchListings(pool, req.query);
    res.json({ listings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PAYMENT ROUTES ---

app.post('/api/payments/initiate', async (req, res) => {
  const { listing_id, purpose } = req.body;
  
  // NOTE: For this test, we are hardcoding a test phone number. 
  // Once auth is fully linked to the frontend, this will come from the logged-in user.
  const phone = '254723516996'; 

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

// Catch-all for undefined routes
app.use((req, res) => res.status(404).send('Cannot GET ' + req.originalUrl));

app.listen(port, () => {
  console.log(`API running on port ${port}`);
});