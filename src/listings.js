// src/listings.js

export async function searchListings(pool, params) {
  let query = `
    SELECT l.id, l.make, l.model, l.year, l.engine_cc, l.price_kes,
           l.condition, l.location_town, l.created_at, l.is_featured,
           (SELECT r2_key FROM listing_images WHERE listing_id = l.id ORDER BY sort_order ASC LIMIT 1) AS cover_key
    FROM listings l
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

  // Order by
  let orderBy = 'l.is_featured DESC, l.created_at DESC';
  if (params.sort === 'price_asc') orderBy = 'l.is_featured DESC, l.price_kes ASC';
  else if (params.sort === 'price_desc') orderBy = 'l.is_featured DESC, l.price_kes DESC';

  query += ` ORDER BY ${orderBy} LIMIT 100`;

  const result = await pool.query(query, values);
  return result.rows;
}