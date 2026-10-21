// src/cron.js

export async function expireStaleListings(pool) {
  const result = await pool.query(
    `UPDATE listings SET status = 'expired', updated_at = now()
     WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now()`
  );
  return result.rowCount;
}

export async function deleteOldListings(pool) {
  const drafts = await pool.query(
    `DELETE FROM listings 
     WHERE status = 'draft' AND created_at < now() - interval '60 days'`
  );
  
  const expired = await pool.query(
    `DELETE FROM listings 
     WHERE status = 'expired' AND expires_at < now() - interval '90 days'`
  );
  
  return { drafts: drafts.rowCount, expired: expired.rowCount };
}