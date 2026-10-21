// src/cron.js

// Moves active listings to expired if their expires_at date has passed
export async function expireStaleListings(pool) {
  const result = await pool.query(
    `UPDATE listings SET status = 'expired', updated_at = now()
     WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now()`
  );
  return result.rowCount;
}

// Deletes draft listings older than 60 days
export async function deleteOldDrafts(pool) {
  const result = await pool.query(
    `DELETE FROM listings 
     WHERE status = 'draft' AND created_at < now() - interval '60 days'`
  );
  return result.rowCount;
}