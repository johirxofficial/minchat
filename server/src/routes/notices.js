import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/errors.js';
import { uuid, validate } from '../lib/validate.js';
import { requireAuth, csrfProtection } from '../middleware/auth.js';
import { activeNotices, dismissNotice } from '../lib/notices.js';

export const noticesRouter = Router();

noticesRouter.use(requireAuth);

noticesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const notices = await activeNotices(req.auth.user.id, req.auth.user.role);
    res.json({
      notices,
      unread: notices.filter((n) => !n.dismissed).length
    });
  })
);

noticesRouter.post(
  '/:id/dismiss',
  csrfProtection,
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const result = await dismissNotice(req.auth.user.id, req.params.id);
    res.json({ ok: true, ...result });
  })
);
