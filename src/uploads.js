// ============================================
// UPLOADS — save/delete files in R2
// ============================================

import { generateId } from './auth.js';

const MAX_PHOTOS = 10;
const MAX_DOCS = 5;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_DOC_BYTES = 10 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_DOC_TYPES = ['application/pdf'];

export async function saveFile(env, file, prefix) {
  const ext = pickExtension(file.name, file.type);
  const key = `${prefix}/${generateId()}.${ext}`;
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type }
  });
  return key;
}

export async function savePhotos(env, files, listingId) {
  const photos = [];
  const list = files.slice(0, MAX_PHOTOS);
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
      throw new Error(`Photo ${file.name} has unsupported type (${file.type}).`);
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new Error(`Photo ${file.name} is larger than 5 MB.`);
    }
    const key = await saveFile(env, file, `listings/${listingId}/photos`);
    photos.push({ key, sort_order: i });
  }
  return photos;
}

export async function saveDocuments(env, files, listingId) {
  const docs = [];
  const list = files.slice(0, MAX_DOCS);
  for (const file of list) {
    if (!ALLOWED_DOC_TYPES.includes(file.type)) {
      throw new Error(`Document ${file.name} must be a PDF.`);
    }
    if (file.size > MAX_DOC_BYTES) {
      throw new Error(`Document ${file.name} is larger than 10 MB.`);
    }
    const key = await saveFile(env, file, `listings/${listingId}/documents`);
    docs.push({ key, doc_type: guessDocType(file.name) });
  }
  return docs;
}

export async function deleteFile(env, key) {
  await env.MEDIA.delete(key);
}

export async function deleteListingMedia(env, listingId) {
  const images = await env.DB.prepare(
    'SELECT r2_key FROM listing_images WHERE listing_id = ?'
  ).bind(listingId).all();
  for (const row of images.results) await env.MEDIA.delete(row.r2_key);

  const docs = await env.DB.prepare(
    'SELECT r2_key FROM listing_documents WHERE listing_id = ?'
  ).bind(listingId).all();
  for (const row of docs.results) await env.MEDIA.delete(row.r2_key);
}

function pickExtension(filename, mime) {
  const fromName = (filename || '').split('.').pop().toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'application/pdf') return 'pdf';
  return 'bin';
}

function guessDocType(filename) {
  const lower = (filename || '').toLowerCase();
  if (lower.includes('logbook')) return 'logbook';
  if (lower.includes('insurance')) return 'insurance';
  if (lower.includes('inspection')) return 'inspection';
  return 'other';
}