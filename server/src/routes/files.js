import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { uuid, validate } from '../lib/validate.js';
import { requireAuth, csrfProtection } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { receiveUpload, fileWithAccess, streamFile } from '../lib/storage.js';
import { one, query } from '../db.js';

export const filesRouter = Router();

filesRouter.post(
  '/',
  requireAuth,
  csrfProtection,
  uploadLimiter,
  asyncHandler(async (req, res) => {
    const result = await receiveUpload(req, req.auth.user.id);
    res.status(201).json({
      file: {
        id: result.file.id,
        name: result.file.original_name,
        mime: result.file.mime,
        size: result.file.size_bytes,
        kind: result.file.kind,
        url: `/api/files/${result.file.id}`
      }
    });
  })
);

filesRouter.get(
  '/:id',
  requireAuth,
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const found = await fileWithAccess(req.params.id, req.auth.user.id);
    if (!found || !found.allowed) {
      res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: 'File not found' } });
      return;
    }
    streamFile(req, res, found.file);
  })
);

filesRouter.delete(
  '/:id',
  requireAuth,
  csrfProtection,
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const file = await one('SELECT * FROM files WHERE id=$1 AND owner_id=$2', [req.params.id, req.auth.user.id]);
    if (!file) {
      res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: 'File not found' } });
      return;
    }
    const used = await query(
      `SELECT 1 FROM attachments WHERE file_id=$1
       UNION ALL SELECT 1 FROM user_profiles WHERE avatar_file_id=$1
       UNION ALL SELECT 1 FROM conversations WHERE image_file_id=$1`,
      [file.id]
    );
    if (used.rowCount) throw badRequest('This file is in use and cannot be removed', 'FILE_IN_USE');
    const deleted = await query('DELETE FROM files WHERE id=$1 RETURNING storage_key', [file.id]);
    const fsp = await import('node:fs/promises');
    const path = await import('node:path');
    const { config } = await import('../config.js');
    await fsp.unlink(path.join(config.storageDir, 'files', deleted.rows[0].storage_key)).catch(() => {});
    res.json({ ok: true });
  })
);
