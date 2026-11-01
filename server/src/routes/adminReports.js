import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { uuid, validate } from '../lib/validate.js';
import { requireAuth, requireCapability, requireStaff, csrfProtection } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

export const adminReportsRouter = Router();

adminReportsRouter.use(requireAuth, requireStaff, csrfProtection);

const STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'];

adminReportsRouter.get(
  '/',
  requireCapability('reports.view'),
  validate(
    z.object({
      status: z.enum([...STATUSES, 'all']).default('open'),
      page: z.coerce.number().int().min(1).max(10000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25)
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const { status, page, limit } = req.validatedQuery;
    const params = [];
    let where = '';
    if (status !== 'all') {
      params.push(status);
      where = 'WHERE r.status=$1';
    }
    params.push(limit, (page - 1) * limit);
    const rows = await query(
      `SELECT r.id, r.reason, r.details, r.status, r.created_at, r.reviewed_at,
              r.message_id, r.conversation_id,
              rep.username AS reporter_username, repp.display_name AS reporter_display_name,
              tar.username AS reported_username, tarp.display_name AS reported_display_name,
              tar.id AS reported_user_id,
              count(*) OVER() AS total
         FROM reports r
         LEFT JOIN users rep ON rep.id=r.reporter_id
         LEFT JOIN user_profiles repp ON repp.user_id=r.reporter_id
         LEFT JOIN users tar ON tar.id=r.reported_id
         LEFT JOIN user_profiles tarp ON tarp.user_id=r.reported_id
        ${where}
        ORDER BY r.created_at ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = rows.rows[0]?.total ?? 0;
    res.json({
      reports: rows.rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: r.created_at,
        reviewedAt: r.reviewed_at,
        hasEvidence: Boolean(r.message_id),
        reporter: { username: r.reporter_username, displayName: r.reporter_display_name },
        reportedUser: {
          id: r.reported_user_id,
          username: r.reported_username,
          displayName: r.reported_display_name
        }
      })),
      pagination: { page, limit, total, hasMore: page * limit < total }
    });
  })
);

adminReportsRouter.get(
  '/:id',
  requireCapability('reports.view'),
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const row = await one(
      `SELECT r.*, rep.username AS reporter_username, repp.display_name AS reporter_display_name,
              tar.id AS reported_user_id, tar.username AS reported_username,
              tarp.display_name AS reported_display_name
         FROM reports r
         LEFT JOIN users rep ON rep.id=r.reporter_id
         LEFT JOIN user_profiles repp ON repp.user_id=r.reporter_id
         LEFT JOIN users tar ON tar.id=r.reported_id
         LEFT JOIN user_profiles tarp ON tarp.user_id=r.reported_id
        WHERE r.id=$1`,
      [req.params.id]
    );
    if (!row) throw notFound('Report not found', 'REPORT_NOT_FOUND');
    res.json({
      report: {
        id: row.id,
        reason: row.reason,
        details: row.details,
        status: row.status,
        resolutionNote: row.resolution_note,
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at,
        reviewedBy: row.reviewed_by,
        messageId: row.message_id,
        conversationId: row.conversation_id,
        hasEvidence: Boolean(row.message_id),
        reporter: { username: row.reporter_username, displayName: row.reporter_display_name },
        reportedUser: {
          id: row.reported_user_id,
          username: row.reported_username,
          displayName: row.reported_display_name
        }
      }
    });
  })
);

adminReportsRouter.get(
  '/:id/evidence',
  requireCapability('reports.view'),
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const report = await one('SELECT id, message_id, conversation_id FROM reports WHERE id=$1', [req.params.id]);
    if (!report) throw notFound('Report not found', 'REPORT_NOT_FOUND');
    if (!report.message_id) return res.json({ evidence: null, notice: 'No message was attached to this report.' });

    const message = await one(
      `SELECT m.id, m.body, m.type, m.created_at, m.deleted_at,
              u.username AS sender_username, p.display_name AS sender_display_name,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'name', f.original_name, 'mime', f.mime, 'size', f.size_bytes, 'url', '/api/files/' || f.id
                ) ORDER BY a.created_at)
                  FROM attachments a JOIN files f ON f.id=a.file_id
                 WHERE a.message_id=m.id
              ), '[]'::json) AS attachments
         FROM messages m
         LEFT JOIN users u ON u.id=m.sender_id
         LEFT JOIN user_profiles p ON p.user_id=m.sender_id
        WHERE m.id=$1`,
      [report.message_id]
    );

    await audit(req.auth.user.id, 'report.evidence_view', {
      targetType: 'report',
      targetId: report.id,
      metadata: { messageId: report.message_id },
      ip: req.ip
    });

    res.json({
      evidence: message
        ? {
            id: message.id,
            body: message.body,
            type: message.type,
            createdAt: message.created_at,
            deletedAt: message.deleted_at,
            sender: { username: message.sender_username, displayName: message.sender_display_name },
            attachments: message.attachments
          }
        : null,
      notice: 'This evidence view was recorded in the audit log.'
    });
  })
);

adminReportsRouter.patch(
  '/:id',
  requireCapability('reports.review'),
  validate(z.object({ id: uuid }), 'params'),
  validate(
    z.object({
      status: z.enum(['reviewing', 'resolved', 'dismissed']),
      resolutionNote: z.string().trim().max(1000).optional()
    })
  ),
  asyncHandler(async (req, res) => {
    const { status, resolutionNote } = req.body;
    const report = await one('SELECT id, status, reported_id FROM reports WHERE id=$1', [req.params.id]);
    if (!report) throw notFound('Report not found', 'REPORT_NOT_FOUND');
    if (report.status === 'resolved' || report.status === 'dismissed') {
      throw badRequest('This report has already been closed', 'REPORT_CLOSED');
    }
    const updated = await one(
      `UPDATE reports
          SET status=$2,
              reviewed_by=$3,
              reviewed_at = CASE WHEN $2 IN ('resolved','dismissed') THEN now() ELSE reviewed_at END,
              resolution_note=$4
        WHERE id=$1
        RETURNING id, status, reviewed_at, resolution_note`,
      [report.id, status, req.auth.user.id, resolutionNote ?? null]
    );
    await audit(req.auth.user.id, 'report.review', {
      targetType: 'report',
      targetId: report.id,
      metadata: { status, hasNote: Boolean(resolutionNote), reportedId: report.reported_id },
      ip: req.ip
    });
    res.json({
      ok: true,
      report: {
        id: updated.id,
        status: updated.status,
        reviewedAt: updated.reviewed_at,
        resolutionNote: updated.resolution_note
      }
    });
  })
);
