// src/listings.js

const getPublicUrl = (key) => {
  if (!key) return null;
  if (key.startsWith('http')) return key;
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/senke-fiti/${key}`;
};

export async function searchListings(pool, params) {
  // MODIFIED: Join users table to get seller_verified
  let query = `
    SELECT l.id, l.make, l.model, l.year, l.engine_cc, l.price_kes,
           l.condition, l.location_town, l.created_at, l.is_featured,
           u.is_verified AS seller_verified,
           (SELECT r2_key FROM listing_images WHERE listing_id = l.id ORDER BY sort_order ASC LIMIT 1) AS cover_key
    FROM listings l
    JOIN users u ON u.id = l.user_id
    WHERE l.status = 'active'
  `;
  const values = [];
  let paramCount = 1;

  if (params.q) {
    query += ` AND (l.make ILIKE $${paramCount} OR l.model ILIKE $${paramCount})`;
    values.push(`%${params.q}%`);
    paramCount++;
  }
  if (params.make) {
    query += ` AND l.make ILIKE $${paramCount}`;
    values.push(`%${params.make}%`);
    paramCount++;
  }
  if (params.town) {
    query += ` AND l.location_town ILIKE $${paramCount}`;
    values.push(`%${params.town}%`);
    paramCount++;
  }
  if (params.price_min) {
    query += ` AND l.price_kes >= $${paramCount}`;
    values.push(parseInt(params.price_min, 10));
    paramCount++;
  }
  if (params.price_max) {
    query += ` AND l.price_kes <= $${paramCount}`;
    values.push(parseInt(params.price_max, 10));
    paramCount++;
  }

  let orderBy = 'l.is_featured DESC, l.created_at DESC';
  if (params.sort === 'price_asc') orderBy = 'l.is_featured DESC, l.price_kes ASC';
  else if (params.sort === 'price_desc') orderBy = 'l.is_featured DESC, l.price_kes DESC';

  query += ` ORDER BY ${orderBy} LIMIT 100`;

  const result = await pool.query(query, values);
  
  return result.rows.map(row => ({
    ...row,
    cover_key: getPublicUrl(row.cover_key)
  }));
}

export async function getUserListings(pool, userId) {
  // MODIFIED: Join users table to get seller_verified for dashboard
  const query = `
    SELECT l.id, l.make, l.model, l.year, l.price_kes, l.status, l.is_paid,
           l.is_featured, l.expires_at, l.created_at, l.location_town,
           u.is_verified AS seller_verified,
           (SELECT r2_key FROM listing_images WHERE listing_id = l.id ORDER BY sort_order ASC LIMIT 1) AS cover_key
    FROM listings l
    JOIN users u ON u.id = l.user_id
    WHERE l.user_id = $1 AND l.status != 'hidden'
    ORDER BY l.created_at DESC
  `;
  const result = await pool.query(query, [userId]);
  
  return result.rows.map(row => ({
    ...row,
    cover_key: getPublicUrl(row.cover_key)
  }));
}

export async function getListing(pool, listingId) {
  const listingRes = await pool.query(`
    SELECT l.*, u.full_name AS seller_name, u.phone AS seller_phone, u.is_verified AS seller_verified
    FROM listings l
    JOIN users u ON u.id = l.user_id
    WHERE l.id = $1
  `, [listingId]);

  if (listingRes.rows.length === 0) return null;
  const listing = listingRes.rows[0];

  const imagesRes = await pool.query(
    'SELECT id, r2_key, sort_order FROM listing_images WHERE listing_id = $1 ORDER BY sort_order ASC',
    [listingId]
  );

  const docsRes = await pool.query(
    'SELECT id, r2_key, doc_type FROM listing_documents WHERE listing_id = $1 ORDER BY created_at ASC',
    [listingId]
  );

  const images = imagesRes.rows.map(img => ({
    ...img,
    r2_key: getPublicUrl(img.r2_key)
  }));

  const documents = docsRes.rows.map(doc => ({
    ...doc,
    r2_key: getPublicUrl(doc.r2_key)
  }));

  return { ...listing, images, documents };
}

export async function activateListing(pool, listingId, months = 12) {
  const days = months * 30;
  await pool.query(
    `UPDATE listings SET
      status = 'active',
      is_paid = true,
      expires_at = now() + ($1 || ' days')::interval,
      updated_at = now()
     WHERE id = $2`
  , [days, listingId]);
}