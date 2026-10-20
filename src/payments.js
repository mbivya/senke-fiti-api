// src/payments.js

const SANDBOX_BASE = 'https://sandbox.kopokopo.com';
const LIVE_BASE    = 'https://api.kopokopo.com';

let cachedToken = null;
let cachedTokenExpiry = 0;

function baseUrl() {
  return process.env.KOPOKOPO_ENV === 'production' ? LIVE_BASE : SANDBOX_BASE;
}

// ---------- AUTH ----------

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) {
    return cachedToken;
  }

  const res = await fetch(`${baseUrl()}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.KOPOKOPO_CLIENT_ID,
      client_secret: process.env.KOPOKOPO_CLIENT_SECRET
    })
  });

  const text = await res.text();
  if (!res.ok) {
    console.error("=== RAW KOPOKOPO AUTH ERROR ===");
    console.error(text);
    console.error("===============================");
    throw new Error(`KopoKopo auth failed (${res.status}): ${text.slice(0, 400)}`);
  }

  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error('KopoKopo auth returned non-JSON: ' + text.slice(0, 200));
  }

  if (!data.access_token) {
    throw new Error('KopoKopo auth: no access_token. Response: ' + text.slice(0, 300));
  }

  cachedToken = data.access_token;
  cachedTokenExpiry = now + 50 * 60 * 1000; // Cache for 50 minutes

  return cachedToken;
}

// ---------- STK PUSH ----------

export async function initiateStkPush({ phone, amount, callbackUrl, metadata }) {
  const token = await getAccessToken();

  // THE FIX: callback_url must be nested inside _links
  const body = {
    payment_channel: 'M-PESA STK Push',
    till_number: process.env.KOPOKOPO_TILL, 
    subscriber: {
      first_name: metadata.first_name || 'Senke',
      last_name: metadata.last_name || 'Fiti',
      phone_number: '+' + phone
    },
    amount: {
      currency: 'KES',
      value: amount
    },
    _links: {
      callback_url: callbackUrl
    },
    metadata: {
      listing_id: metadata.listing_id,
      purpose: metadata.purpose
    }
  };

  const res = await fetch(`${baseUrl()}/api/v2/incoming_payments`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("A payment request is already pending for this phone number. Please wait a moment and try again.");
    }
    
    console.error("=== RAW KOPOKOPO STK ERROR ===");
    console.error(text);
    console.error("==============================");

    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.message || parsed.error || parsed.errors || JSON.stringify(parsed);
    } catch {}
    throw new Error(`STK push failed (${res.status}): ${detail}`);
  }

  const location = res.headers.get('Location');
  const resourceId = location ? location.split('/').pop() : null;

  return {
    id: resourceId,
    location,
    raw: text
  };
}

// ---------- WEBHOOK SIGNATURE VERIFICATION ----------

export async function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;

  const [algo, providedHex] = signatureHeader.split('=');
  if (!algo || !providedHex) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(process.env.KOPOKOPO_CLIENT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computedHex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');

  if (computedHex.length !== providedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) {
    diff |= computedHex.charCodeAt(i) ^ providedHex.toLowerCase().charCodeAt(i);
  }
  return diff === 0;
}