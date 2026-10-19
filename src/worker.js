import {
  hashPassword, verifyPassword, generateId,
  createSession, getUserFromToken, deleteSession,
  getCookie, buildSessionCookie, buildLogoutCookie, normalizePhone
} from './auth.js';

import {
  createListing, getListing, searchListings, getUserListings,
  updateListing, renewListing, activateListing, markFeatured,
  hideListing, restoreListing, deleteListing, expireStaleListings
} from './listings.js';

import {
  listReports, hideReportedListing, dismissReport, restoreReportedListing,
  listVerifications, approveVerification, rejectVerification,
  listAllListings, listAllUsers,
  searchListingsAdmin, searchUsersAdmin,
  updateUserStatus, updateUserRole
} from './admin.js';

import { initiateStkPush, verifyWebhookSignature } from './payments.js';
import { getVerificationStatus, submitVerification } from './verify.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/media/')) {
      const key = path.replace('/media/', '');
      const obj = await env.MEDIA.get(key);
      if (!obj) return new Response('Not found', { status: 404 });
      return new Response(obj.body, {
        headers: {
          'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000'
        }
      });
    }

    if (path.startsWith('/api/')) {
      try {
        return await handleApi(request, env, path, url);
      } catch (err) {
        return Response.json({ error: 'Server error', detail: err.message }, { status: 500 });
      }
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    const count = await expireStaleListings(env);
    console.log('Cron: expired', count, 'listing(s) at', new Date(event.scheduledTime).toISOString());
  }
};

async function handleApi(request, env, path, url) {
  const method = request.method;

  if (path === '/api/hello') {
    return Response.json({ message: 'Senke Fiti backend is alive.', time: new Date().toISOString() });
  }

  if (path === '/api/me') {
    const token = getCookie(request, 'session');
    const user = await getUserFromToken(env, token);
    if (!user) return Response.json({ user: null }, { status: 401 });
    return Response.json({ user });
  }

  if (path === '/api/signup' && method === 'POST') return handleSignup(request, env);
  if (path === '/api/login'  && method === 'POST') return handleLogin(request, env);
  if (path === '/api/logout' && method === 'POST') return handleLogout(request, env);

  if (path === '/api/listings' && method === 'POST') return handleCreateListing(request, env);
  if (path === '/api/listings' && method === 'GET')  return handleSearchListings(env, url);
  if (path === '/api/listings/mine' && method === 'GET') return handleMyListings(request, env);
  if (path.startsWith('/api/listings/') && path.endsWith('/renew') && method === 'POST') return handleRenew(request, env, path);
  if (path.startsWith('/api/listings/') && path.endsWith('/delete') && method === 'POST') return handleDelete(request, env, path);
  if (path.startsWith('/api/listings/') && method === 'GET') return handleGetListing(env, path);
  if (path.startsWith('/api/listings/') && method === 'PUT') return handleUpdateListing(request, env, path);

  if (path === '/api/reports' && method === 'POST') return handleCreateReport(request, env);

  if (path === '/api/verify/status' && method === 'GET') return handleVerifyStatus(request, env);
  if (path === '/api/verify/apply'  && method === 'POST') return handleVerifyApply(request, env);

  if (path === '/api/payments/initiate' && method === 'POST') return handleInitiatePayment(request, env);
  if (path === '/api/payments/webhook'  && method === 'POST') return handlePaymentWebhook(request, env);

  if (path.startsWith('/api/admin/')) return handleAdmin(request, env, path, method, url);

  if (path === '/api/cron/expire' && method === 'POST') {
    const count = await expireStaleListings(env);
    return Response.json({ ok: true, expired: count });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

// ---------- AUTH HANDLERS ----------

async function handleSignup(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 });

  const { phone, password, full_name } = body;
  if (!phone || !password || !full_name) {
    return Response.json({ error: 'Phone, password, and full name are required.' }, { status: 400 });
  }
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return Response.json({ error: 'Enter a valid Kenyan phone number.' }, { status: 400 });
  if (password.length < 6) return Response.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });

  const existing = await env.DB.prepare('SELECT id FROM users WHERE phone = ?').bind(normalizedPhone).first();
  if (existing) return Response.json({ error: 'That phone number is already registered.' }, { status: 409 });

  const userId = generateId('user');
  const passwordHash = await hashPassword(password);

  await env.DB.prepare(
    'INSERT INTO users (id, phone, password_hash, full_name) VALUES (?, ?, ?, ?)'
  ).bind(userId, normalizedPhone, passwordHash, full_name.trim()).run();

  const token = await createSession(env, userId, request.headers.get('User-Agent'));
  return Response.json(
    { ok: true, user: { id: userId, phone: normalizedPhone, full_name: full_name.trim() } },
    { status: 201, headers: { 'Set-Cookie': buildSessionCookie(token) } }
  );
}

async function handleLogin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 });

  const { phone, password } = body;
  if (!phone || !password) return Response.json({ error: 'Phone and password required.' }, { status: 400 });

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return Response.json({ error: 'Invalid phone number.' }, { status: 400 });

  const user = await env.DB.prepare(
    'SELECT id, phone, full_name, role, status, is_verified, password_hash FROM users WHERE phone = ?'
  ).bind(normalizedPhone).first();

  if (!user) return Response.json({ error: 'Invalid phone or password.' }, { status: 401 });

  if (user.status && user.status !== 'active') {
    return Response.json(
      { error: user.status === 'banned'
          ? 'This account has been permanently blocked.'
          : 'This account is suspended. Contact support.' },
      { status: 403 }
    );
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return Response.json({ error: 'Invalid phone or password.' }, { status: 401 });

  const token = await createSession(env, user.id, request.headers.get('User-Agent'));
  return Response.json(
    { ok: true, user: { id: user.id, phone: user.phone, full_name: user.full_name, role: user.role, is_verified: user.is_verified } },
    { headers: { 'Set-Cookie': buildSessionCookie(token) } }
  );
}

async function handleLogout(request, env) {
  const token = getCookie(request, 'session');
  if (token) await deleteSession(env, token);
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': buildLogoutCookie() } });
}

// ---------- LISTING HANDLERS ----------

async function handleCreateListing(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: 'Please log in first.' }, { status: 401 });

  const formData = await request.formData();
  try {
    const listingId = await createListing(env, user, formData);
    return Response.json({ ok: true, listing_id: listingId }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

async function handleSearchListings(env, url) {
  const params = Object.fromEntries(url.searchParams.entries());
  const listings = await searchListings(env, params);
  return Response.json({ listings });
}

async function handleMyListings(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: 'Please log in first.' }, { status: 401 });
  const listings = await getUserListings(env, user.id);
  return Response.json({ listings });
}

async function handleGetListing(env, path) {
  const listingId = path.replace('/api/listings/', '');
  const listing = await getListing(env, listingId);
  if (!listing) return Response.json({ error: 'Listing not found.' }, { status: 404 });
  return Response.json({ listing });
}

async function handleUpdateListing(request, env, path) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: 'Please log in first.' }, { status: 401 });
  const listingId = path.replace('/api/listings/', '');
  const formData = await request.formData();
  try {
    await updateListing(env, listingId, user.id, formData);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

async function handleRenew(request, env, path) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: 'Please log in first.' }, { status: 401 });
  const listingId = path.replace('/api/listings/', '').replace('/renew', '');
  try {
    await renewListing(env, listingId, user.id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

async function handleDelete(request, env, path) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: 'Please log in first.' }, { status: 401 });
  const listingId = path.replace('/api/listings/', '').replace('/delete', '');
  try {
    await deleteListing(env, listingId, user.id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

// ---------- REPORT HANDLER ----------

async function handleCreateReport(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 });

  const { listing_id, reason, details } = body;
  if (!listing_id || !reason) return Response.json({ error: 'Missing listing_id or reason.' }, { status: 400 });

  const user = await currentUser(request, env);

  await env.DB.prepare(
    'INSERT INTO reports (id, listing_id, reporter_id, reason, details) VALUES (?, ?, ?, ?, ?)'
  ).bind(generateId('report'), listing_id, user?.id || null, reason, details || null).run();

  await hideListing(env, listing_id);

  return Response.json({ ok: true }, { status: 201 });
}

// ---------- VERIFICATION HANDLERS ----------

async function handleVerifyStatus(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: 'Not logged in' }, { status: 401 });
  const status = await getVerificationStatus(env, user.id);
  return Response.json(status);
}

async function handleVerifyApply(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: 'Please log in first.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 });

  try {
    const id = await submitVerification(env, user.id, body);
    return Response.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

// ---------- PAYMENT HANDLERS ----------

async function handleInitiatePayment(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: 'Please log in first.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 });

  const { listing_id, purpose } = body;
  if (!listing_id || !purpose) return Response.json({ error: 'listing_id and purpose required.' }, { status: 400 });

  const PRICES = { standard_listing: 300, featured_listing: 1000, verified_badge: 500 };
  const amount = PRICES[purpose];
  if (!amount) return Response.json({ error: 'Unknown purpose.' }, { status: 400 });

  const listing = await env.DB.prepare('SELECT id, user_id FROM listings WHERE id = ?').bind(listing_id).first();
  if (!listing || listing.user_id !== user.id) return Response.json({ error: 'Listing not found.' }, { status: 404 });

  const phone = user.phone || body.phone;
  if (!phone) return Response.json({ error: 'No phone on file.' }, { status: 400 });

  const origin = new URL(request.url).origin;
  const callbackUrl = `${origin}/api/payments/webhook`;

  const paymentId = generateId('pay');
  const merchantRef = 'SF-' + Date.now() + '-' + paymentId.slice(-6);
  await env.DB.prepare(
    `INSERT INTO payments (id, user_id, listing_id, purpose, amount_kes, phone, merchant_ref, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(paymentId, user.id, listing_id, purpose, amount, phone, merchantRef).run();

  try {
    const result = await initiateStkPush(env, {
      phone,
      amount,
      callbackUrl,
      metadata: {
        first_name: user.full_name.split(' ')[0] || 'Senke',
        last_name: user.full_name.split(' ')[1] || 'Fiti',
        listing_id,
        purpose
      }
    });

    await env.DB.prepare(
      'UPDATE payments SET checkout_id = ? WHERE id = ?'
    ).bind(result?.id || null, paymentId).run();

    return Response.json({
      ok: true,
      payment_id: paymentId,
      message: 'STK push sent. Check your phone.'
    });
  } catch (err) {
    await env.DB.prepare(
      "UPDATE payments SET status = 'failed', failure_reason = ? WHERE id = ?"
    ).bind(err.message, paymentId).run();
    return Response.json({ error: err.message }, { status: 400 });
  }
}

async function handlePaymentWebhook(request, env) {
  const rawBody = await request.text();
  const signature = request.headers.get('X-KopoKopo-Signature');

  // Verify signature
  const valid = await verifyWebhookSignature(env, rawBody, signature);
  if (!valid) {
    console.warn('Webhook rejected: invalid signature');
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }); }

  // K2 Connect wraps events in { data: { type, id, attributes: {...} } }
  const data = payload?.data || payload;
  const attrs = data?.attributes || data;

  const status = attrs?.status || payload?.status;
  const reference = attrs?.reference || attrs?.transaction_reference || payload?.reference;
  const receipt = attrs?.transaction_reference || attrs?.receipt_number || null;
  const metadata = attrs?.metadata || payload?.metadata || {};
  const listingId = metadata?.listing_id;
  const purpose = metadata?.purpose;

  // Try to find the matching payment row by reference
  let payment = null;
  if (reference) {
    payment = await env.DB.prepare(
      'SELECT id FROM payments WHERE merchant_ref = ? OR checkout_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(reference, reference).first();
  }

  // Fallback: find latest pending payment for this listing + purpose
  if (!payment && listingId && purpose) {
    payment = await env.DB.prepare(
      `SELECT id FROM payments
       WHERE listing_id = ? AND purpose = ? AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`
    ).bind(listingId, purpose).first();
  }

  if (payment) {
    const normalizedStatus = String(status || '').toLowerCase();
    const isSuccess = normalizedStatus === 'success'
      || normalizedStatus === 'complete'
      || normalizedStatus === 'completed';

    await env.DB.prepare(
      `UPDATE payments SET status = ?, mpesa_receipt = ?, raw_callback = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(
      isSuccess ? 'success' : 'failed',
      receipt,
      rawBody.slice(0, 4000),
      payment.id
    ).run();

    if (isSuccess) {
      if (listingId && purpose === 'standard_listing') {
        await activateListing(env, listingId, 12);
      } else if (listingId && purpose === 'featured_listing') {
        await activateListing(env, listingId, 12);
        await markFeatured(env, listingId, 1);
      }
    }
  } else {
    console.warn('Webhook received but no matching payment row. Reference:', reference, 'Listing:', listingId);
  }

  return Response.json({ ok: true, processed: !!payment });
}

// ---------- ADMIN HANDLERS ----------

async function handleAdmin(request, env, path, method, url) {
  const admin = await currentUser(request, env);
  if (!admin || (admin.role !== 'admin' && admin.role !== 'super_admin')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (path === '/api/admin/reports' && method === 'GET') {
    return Response.json({ reports: await listReports(env) });
  }
  if (path.startsWith('/api/admin/reports/') && method === 'POST') {
    const parts = path.split('/');
    const id = parts[4];
    const action = parts[5];
    if (action === 'hide')         await hideReportedListing(env, id, admin.id);
    else if (action === 'dismiss') await dismissReport(env, id, admin.id);
    else if (action === 'restore') await restoreReportedListing(env, id, admin.id);
    return Response.json({ ok: true });
  }

  if (path === '/api/admin/verifications' && method === 'GET') {
    return Response.json({ verifications: await listVerifications(env) });
  }
  if (path.startsWith('/api/admin/verifications/') && method === 'POST') {
    const parts = path.split('/');
    const id = parts[4];
    const action = parts[5];
    if (action === 'approve')     await approveVerification(env, id, admin.id);
    else if (action === 'reject') await rejectVerification(env, id, admin.id, 'Rejected by admin');
    return Response.json({ ok: true });
  }

  if (path === '/api/admin/listings' && method === 'GET') {
    const q = url.searchParams.get('q');
    const listings = q ? await searchListingsAdmin(env, q) : await listAllListings(env);
    return Response.json({ listings });
  }

  if (path === '/api/admin/users' && method === 'GET') {
    const q = url.searchParams.get('q');
    const users = q ? await searchUsersAdmin(env, q) : await listAllUsers(env);
    return Response.json({ users });
  }

  if (path.match(/^\/api\/admin\/users\/[^/]+\/status$/) && method === 'POST') {
    const targetId = path.split('/')[4];
    const body = await request.json().catch(() => null);
    if (!body || !body.status) return Response.json({ error: 'Missing status' }, { status: 400 });
    try {
      await updateUserStatus(env, targetId, body.status, admin);
      return Response.json({ ok: true });
    } catch (err) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  if (path.match(/^\/api\/admin\/users\/[^/]+\/role$/) && method === 'POST') {
    const targetId = path.split('/')[4];
    const body = await request.json().catch(() => null);
    if (!body || !body.role) return Response.json({ error: 'Missing role' }, { status: 400 });
    try {
      await updateUserRole(env, targetId, body.role, admin);
      return Response.json({ ok: true });
    } catch (err) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  return Response.json({ error: 'Unknown admin route' }, { status: 404 });
}

// ---------- HELPERS ----------

async function currentUser(request, env) {
  const token = getCookie(request, 'session');
  return await getUserFromToken(env, token);
}