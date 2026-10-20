// src/payments.js
import crypto from 'crypto';

const SANDBOX_BASE = 'https://sandbox.kopokopo.com';
const LIVE_BASE    = 'https://api.kopokopo.com';

let cachedToken = null;
let cachedTokenExpiry = 0;

function baseUrl() {
  return process.env.KOPOKOPO_ENV === 'production' ? LIVE_BASE : SANDBOX_BASE;
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) return cachedToken;

  const res = await fetch(`${baseUrl()}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.KOPOKOPO_CLIENT_ID,
      client_secret: process.env.KOPOKOPO_CLIENT_SECRET
    })
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`KopoKopo auth failed (${res.status}): ${text}`);
  let data = JSON.parse(text);
  cachedToken = data.access_token;
  cachedTokenExpiry = now + 50 * 60 * 1000;
  return cachedToken;
}

export async function initiateStkPush({ phone, amount, callbackUrl, metadata }) {
  const token = await getAccessToken();
  const idempotencyKey = crypto.randomBytes(16).toString('hex');

  const body = {
    payment_channel: 'M-PESA STK Push',
    till_number: process.env.KOPOKOPO_TILL, 
    subscriber: {
      first_name: metadata.first_name || 'Senke',
      last_name: metadata.last_name || 'Fiti',
      phone_number: '+' + phone
    },
    amount: { currency: 'KES', value: amount },
    metadata: { listing_id: metadata.listing_id, purpose: metadata.purpose },
    _links: { callback_url: callbackUrl }
  };

  const res = await fetch(`${baseUrl()}/api/v2/incoming_payments`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`STK push failed (${res.status}): ${text}`);

  const location = res.headers.get('Location');
  const resourceId = location ? location.split('/').pop() : null;
  return { id: resourceId, location, raw: text };
}

export async function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const [algo, providedHex] = signatureHeader.split('=');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(process.env.KOPOKOPO_CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computedHex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return computedHex === providedHex.toLowerCase();
}