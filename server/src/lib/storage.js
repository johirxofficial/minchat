import Busboy from 'busboy';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { one, query } from '../db.js';
import { badRequest, forbidden, notFound, payloadTooLarge } from './errors.js';
import { logger } from '../logger.js';
import { areFriends } from './access.js';

const TMP_DIR = path.join(config.storageDir, 'tmp');
const FILES_DIR = path.join(config.storageDir, 'files');

const IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO = ['video/mp4', 'video/webm', 'video/quicktime'];
const AUDIO = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a', 'audio/aac'];
const DOCUMENT = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'text/plain',
  'text/csv',
  'text/markdown'
];

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md'
};

const KIND_BY_CATEGORY = { image: 'image', video: 'video', audio: 'audio', document: 'document' };
const TEXT_EXT = new Set(['.txt', '.csv', '.md']);

function categoryOf(mime) {
  if (IMAGE.includes(mime)) return 'image';
  if (VIDEO.includes(mime)) return 'video';
  if (AUDIO.includes(mime)) return 'audio';
  if (DOCUMENT.includes(mime)) return 'document';
  return null;
}

export function safeOriginalName(name) {
  const base = path.basename(String(name || 'file')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (base.slice(0, 180) || 'file');
}

export async function ensureStorageDirs() {
  await fsp.mkdir(TMP_DIR, { recursive: true, mode: 0o750 });
  await fsp.mkdir(FILES_DIR, { recursive: true, mode: 0o750 });
  await fsp.chmod(TMP_DIR, 0o750).catch(() => {});
  await fsp.chmod(FILES_DIR, 0o750).catch(() => {});
}

async function sniffText(filePath) {
  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const sample = buf.subarray(0, bytesRead);
    if (sample.includes(0)) return false;
    // Reject HTML/script-ish documents even when renamed to .txt.
    const text = sample.toString('utf8').toLowerCase();
    return !/<(?:script|html|iframe|object|embed|svg)\b/.test(text);
  } finally {
    await fh.close();
  }
}

async function inspectAndStore({ tmpPath, filename, clientMime, size, sha256, kindHint, userId }) {
  const { fileTypeFromFile } = await import('file-type');
  const detected = await fileTypeFromFile(tmpPath).catch(() => null);
  let mime = detected?.mime ?? null;
  const extFromName = path.extname(filename).toLowerCase();

  // MediaRecorder commonly labels WebM audio as video/webm and MP4 audio as video/mp4.
  if (mime === 'video/webm' && (kindHint === 'audio' || clientMime?.startsWith('audio/'))) mime = 'audio/webm';
  if (mime === 'video/mp4' && (kindHint === 'audio' || clientMime?.startsWith('audio/'))) mime = 'audio/mp4';

  let textFallback = false;
  if (!mime && TEXT_EXT.has(extFromName)) {
    const ok = await sniffText(tmpPath);
    if (!ok) throw badRequest('That file type is not allowed', 'FILE_TYPE_NOT_ALLOWED');
    mime = extFromName === '.csv' ? 'text/csv' : extFromName === '.md' ? 'text/markdown' : 'text/plain';
    textFallback = true;
  }

  if (!mime) throw badRequest('Could not verify the file type', 'FILE_TYPE_UNKNOWN');

  const category = categoryOf(mime);
  if (!category) throw badRequest('That file type is not allowed', 'FILE_TYPE_NOT_ALLOWED');

  if (kindHint === 'avatar' || kindHint === 'group_avatar') {
    if (category !== 'image') throw badRequest('Profile photos must be JPEG, PNG, WebP or GIF images', 'INVALID_IMAGE');
  } else if (kindHint && KIND_BY_CATEGORY[category] !== kindHint) {
    throw badRequest(`The uploaded file is not a valid ${kindHint}`, 'FILE_KIND_MISMATCH');
  }

  const ext = EXT_BY_MIME[mime] || detected?.ext;
  if (!ext) throw badRequest('Unsupported file type', 'FILE_TYPE_NOT_ALLOWED');

  const now = new Date();
  const relDir = path.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
  const key = path.posix.join(relDir.split(path.sep).join('/'), `${randomUUID()}.${ext}`);
  const destDir = path.join(FILES_DIR, relDir);
  await fsp.mkdir(destDir, { recursive: true, mode: 0o750 });
  const dest = path.join(FILES_DIR, key);
  await fsp.rename(tmpPath, dest);
  await fsp.chmod(dest, 0o600);

  const kind = kindHint || KIND_BY_CATEGORY[category];
  const file = await one(
    `INSERT INTO files (owner_id, storage_key, original_name, mime, size_bytes, sha256, kind)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [userId, key.replaceAll('\\', '/'), safeOriginalName(filename), mime, size, sha256, kind]
  );
  logger.info({ fileId: file.id, kind, mime, size, textFallback }, 'file stored');
  return { file, category };
}

export async function receiveUpload(req, userId, kindHint) {
  await ensureStorageDirs();
  if (!req.headers['content-type']?.includes('multipart/form-data')) {
    throw badRequest('Expected a multipart upload', 'INVALID_UPLOAD');
  }
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength && contentLength > config.maxUploadBytes + 2 * 1024 * 1024) {
    throw payloadTooLarge(`Files must be at most ${config.maxUploadMb} MB`);
  }

  let bb;
  try {
    bb = Busboy({
      headers: req.headers,
      limits: { fileSize: config.maxUploadBytes, files: 1, fields: 6, parts: 8 }
    });
  } catch {
    throw badRequest('Malformed upload', 'INVALID_UPLOAD');
  }

  return new Promise((resolve, reject) => {
    let filePromise = null;
    let fileSeen = false;
    let tooLarge = false;
    let finished = false;
    const fields = {};
    const tmpFiles = [];

    const fail = (err) => {
      if (finished) return;
      finished = true;
      reject(err);
    };

    bb.on('field', (name, value) => {
      if (Object.keys(fields).length < 6) fields[name] = String(value).slice(0, 200);
    });

    bb.on('file', (name, stream, info) => {
      if (name !== 'file' || fileSeen) {
        stream.resume();
        return;
      }
      fileSeen = true;
      const tmpPath = path.join(TMP_DIR, `${randomUUID()}.part`);
      tmpFiles.push(tmpPath);
      const out = fs.createWriteStream(tmpPath, { mode: 0o600 });
      const hash = createHash('sha256');
      let size = 0;

      filePromise = new Promise((res, rej) => {
        out.on('error', rej);
        out.on('close', () => res());
        stream.on('data', (chunk) => {
          size += chunk.length;
          hash.update(chunk);
        });
        stream.on('limit', () => {
          tooLarge = true;
          out.destroy(new Error('FILE_TOO_LARGE'));
        });
        stream.on('error', rej);
        stream.pipe(out);
      }).then(() => ({
        tmpPath,
        filename: info.filename,
        clientMime: info.mimeType,
        size,
        sha256: hash.digest('hex')
      }));
    });

    bb.on('error', () => fail(badRequest('Malformed upload', 'INVALID_UPLOAD')));

    bb.on('finish', async () => {
      if (finished) return;
      try {
        if (!fileSeen || !filePromise) throw badRequest('Choose a file to upload', 'NO_FILE');
        if (tooLarge) throw payloadTooLarge(`Files must be at most ${config.maxUploadMb} MB`);
        const uploaded = await filePromise;
        if (!uploaded.size) throw badRequest('The uploaded file is empty', 'EMPTY_FILE');

        const used = await one('SELECT COALESCE(SUM(size_bytes),0)::bigint AS n FROM files WHERE owner_id=$1', [userId]);
        if (Number(used.n) + uploaded.size > config.userQuotaBytes) {
          throw payloadTooLarge(`This upload would exceed your ${config.userQuotaMb} MB storage quota`, 'STORAGE_QUOTA_EXCEEDED');
        }

        const result = await inspectAndStore({
          ...uploaded,
          kindHint: fields.kind === undefined ? kindHint : fields.kind,
          userId
        });
        finished = true;
        resolve(result);
      } catch (err) {
        fail(err);
      } finally {
        for (const tmp of tmpFiles) fsp.unlink(tmp).catch(() => {});
      }
    });

    req.pipe(bb);
  });
}

export async function fileWithAccess(fileId, viewerId) {
  const file = await one('SELECT * FROM files WHERE id=$1', [fileId]);
  if (!file) return null;
  if (file.owner_id === viewerId) return { file, allowed: true };

  if (file.kind === 'avatar') {
    const row = await one(
      `SELECT p.avatar_visibility, p.user_id FROM user_profiles p WHERE p.avatar_file_id=$1`,
      [fileId]
    );
    if (!row) return { file, allowed: false };
    if (row.avatar_visibility === 'public') return { file, allowed: true };
    return { file, allowed: await areFriends(row.user_id, viewerId) };
  }

  if (file.kind === 'group_avatar') {
    const row = await one('SELECT id FROM conversations WHERE image_file_id=$1', [fileId]);
    if (!row) return { file, allowed: false };
    const member = await one(
      'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL',
      [row.id, viewerId]
    );
    return { file, allowed: Boolean(member) };
  }

  const row = await one(
    `SELECT m.deleted_at, m.conversation_id
       FROM attachments a JOIN messages m ON m.id=a.message_id
      WHERE a.file_id=$1`,
    [fileId]
  );
  if (!row || row.deleted_at) return { file, allowed: false };
  const member = await one(
    'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL',
    [row.conversation_id, viewerId]
  );
  return { file, allowed: Boolean(member) };
}

export function streamFile(req, res, file) {
  const absolute = path.join(FILES_DIR, file.storage_key);
  // Defence in depth: storage_key is generated server-side, but never allow escapes.
  if (!absolute.startsWith(FILES_DIR + path.sep)) throw notFound('File not found');

  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    throw notFound('File not found');
  }
  if (!stat.isFile()) throw notFound('File not found');

  const inline = ['image', 'video', 'audio'].includes(file.kind);
  const disposition = inline ? 'inline' : 'attachment';
  const encoded = encodeURIComponent(file.original_name).replace(/['()]/g, escape);

  res.setHeader('Content-Type', file.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encoded}`);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  let start = 0;
  let end = stat.size - 1;
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) {
      res.status(416).setHeader('Content-Range', `bytes */${stat.size}`);
      return res.end();
    }
    if (m[1]) start = Number(m[1]);
    if (m[2]) end = Number(m[2]);
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
      res.status(416).setHeader('Content-Range', `bytes */${stat.size}`);
      return res.end();
    }
    end = Math.min(end, stat.size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', String(end - start + 1));
  } else {
    res.setHeader('Content-Length', String(stat.size));
  }

  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(absolute, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

export async function deleteFile(fileId) {
  const file = await one('DELETE FROM files WHERE id=$1 RETURNING storage_key', [fileId]);
  if (!file) return;
  await fsp.unlink(path.join(FILES_DIR, file.storage_key)).catch(() => {});
}

export async function deleteFilesForMessage(messageId) {
  const files = await query(
    'SELECT f.id, f.storage_key FROM attachments a JOIN files f ON f.id=a.file_id WHERE a.message_id=$1',
    [messageId]
  );
  if (!files.rows.length) return;
  await query('DELETE FROM files WHERE id = ANY($1::uuid[])', [files.rows.map((r) => r.id)]);
  await Promise.all(
    files.rows.map((f) => fsp.unlink(path.join(FILES_DIR, f.storage_key)).catch(() => {}))
  );
}

export async function storageUsage(userId = null) {
  const row = userId
    ? await one('SELECT COUNT(*)::int AS count, COALESCE(SUM(size_bytes),0)::bigint AS bytes FROM files WHERE owner_id=$1', [userId])
    : await one('SELECT COUNT(*)::int AS count, COALESCE(SUM(size_bytes),0)::bigint AS bytes FROM files');
  return { count: row.count, bytes: Number(row.bytes) };
}

export async function removeOrphanFiles(olderThanHours = 24) {
  const rows = await query(
    `SELECT f.id, f.storage_key FROM files f
      WHERE f.created_at < now() - ($1 || ' hours')::interval
        AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.file_id=f.id)
        AND NOT EXISTS (SELECT 1 FROM user_profiles p WHERE p.avatar_file_id=f.id)
        AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.image_file_id=f.id)`,
    [String(olderThanHours)]
  );
  for (const row of rows.rows) {
    await fsp.unlink(path.join(FILES_DIR, row.storage_key)).catch(() => {});
  }
  if (rows.rows.length) {
    await query('DELETE FROM files WHERE id = ANY($1::uuid[])', [rows.rows.map((r) => r.id)]);
  }
  return rows.rows.length;
}
