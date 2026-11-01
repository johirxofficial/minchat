import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../lib/errors.js';
import { uuid, validate } from '../lib/validate.js';
import { requireAuth, csrfProtection } from '../middleware/auth.js';
import { editMessage, deleteMessage, addReaction, removeReaction } from '../services/messages.js';

export const messagesRouter = Router();

messagesRouter.patch(
  '/:id',
  requireAuth,
  csrfProtection,
  validate(z.object({ id: uuid }), 'params'),
  validate(z.object({ body: z.string().max(4000) })),
  asyncHandler(async (req, res) => {
    const message = await editMessage(req.params.id, req.auth.user.id, req.body.body);
    res.json({ message });
  })
);

messagesRouter.delete(
  '/:id',
  requireAuth,
  csrfProtection,
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const message = await deleteMessage(req.params.id, req.auth.user.id);
    res.json({ message });
  })
);

messagesRouter.post(
  '/:id/reactions',
  requireAuth,
  csrfProtection,
  validate(z.object({ id: uuid }), 'params'),
  validate(z.object({ emoji: z.string().min(1).max(16) })),
  asyncHandler(async (req, res) => {
    const reactions = await addReaction(req.params.id, req.auth.user.id, req.body.emoji);
    res.json({ reactions });
  })
);

messagesRouter.delete(
  '/:id/reactions',
  requireAuth,
  csrfProtection,
  validate(z.object({ id: uuid }), 'params'),
  validate(z.object({ emoji: z.string().min(1).max(16) }), 'query'),
  asyncHandler(async (req, res) => {
    const reactions = await removeReaction(req.params.id, req.auth.user.id, req.validatedQuery.emoji);
    res.json({ reactions });
  })
);
