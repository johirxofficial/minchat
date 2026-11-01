import express from 'express';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, projectRoot } from './config.js';
import { logger } from './logger.js';
import { AppError } from './lib/errors.js';
import { securityHeaders, corsMiddleware, originGuard } from './middleware/security.js';
import { loadAuth } from './middleware/auth.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { friendsRouter } from './routes/friends.js';
import { conversationsRouter } from './routes/conversations.js';
import { messagesRouter } from './routes/messages.js';
import { searchRouter } from './routes/search.js';
import { filesRouter } from './routes/files.js';
import { notificationsRouter } from './routes/notifications.js';
import { reportsRouter } from './routes/reports.js';
import { callsRouter } from './routes/calls.js';
import { adminRouter } from './routes/admin.js';
import { adminUsersRouter } from './routes/adminUsers.js';
import { adminReportsRouter } from './routes/adminReports.js';
import { adminConsoleRouter } from './routes/adminConsole.js';
import { noticesRouter } from './routes/notices.js';
import { healthRouter } from './routes/health.js';
import { isStaff } from './lib/permissions.js';
import { getSettings } from './lib/settings.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../../client/dist');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('query parser', 'simple');

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = req.headers['x-request-id'] || randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      serializers: {
        req(req) {
          return {
            method: req.method,
            path: String(req.url || '').split('?')[0],
            remoteAddress: req.remoteAddress
          };
        },
        res(res) {
          return { statusCode: res.statusCode };
        }
      }
    })
  );

  app.use(cookieParser());
  app.use(corsMiddleware);
  app.use(originGuard);

  app.use('/api', securityHeaders());
  app.use('/api', express.json({ limit: '1mb' }));
  app.use('/api', loadAuth);
  app.use('/api', apiLimiter);

  // Maintenance mode pauses member traffic while leaving sign-in, health,
  // notices and the staff console reachable so the deployment can be fixed.
  app.use('/api', async (req, _res, next) => {
    try {
      const open =
        req.path.startsWith('/auth') ||
        req.path.startsWith('/health') ||
        req.path.startsWith('/notices') ||
        req.path.startsWith('/admin');
      if (open) return next();
      const settings = await getSettings();
      if (settings.maintenance_mode && !isStaff(req.auth?.user?.role)) {
        return next(new AppError(503, 'MAINTENANCE', settings.maintenance_message));
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/friends', friendsRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/calls', callsRouter);
  app.use('/api/notices', noticesRouter);
  app.use('/api/admin/users', adminUsersRouter);
  app.use('/api/admin/reports', adminReportsRouter);
  app.use('/api/admin', adminConsoleRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
  });

  if (config.serveStatic && fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(
      express.static(clientDist, {
        index: false,
        maxAge: '1y',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        }
      })
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use((err, req, res, _next) => {
    const requestId = req.id;
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong on our side.';
    let details;

    if (err instanceof AppError) {
      status = err.status;
      code = err.code;
      message = err.message;
      details = err.details;
    } else if (err.type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
      message = 'The request body is not valid JSON.';
    } else if (err.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'That request is too large.';
    } else if (err.status && err.status < 500) {
      status = err.status;
      code = err.code || 'REQUEST_FAILED';
      message = err.message;
    } else if (err.code === '23505') {
      status = 409;
      code = 'DUPLICATE';
      message = 'That action conflicts with an existing record.';
    } else if (err.code === '23503') {
      status = 409;
      code = 'RELATION_CONFLICT';
      message = 'That action references data that no longer exists.';
    }

    if (status >= 500) {
      logger.error({ err, reqId: requestId, path: req.path }, 'unhandled request error');
    }
    if (res.headersSent) return;
    res.status(status).json({
      error: { code, message, ...(details ? { details } : {}), requestId }
    });
  });

  return app;
}
