import helmet from 'helmet';
import { config } from '../config.js';
import { forbidden } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"]
      }
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: config.cookieSecure ? { maxAge: 15552000, includeSubDomains: false } : false,
    frameguard: { action: 'deny' }
  });
}

function isAllowed(origin) {
  if (!origin) return true;
  return config.allowedOrigins.includes(origin.replace(/\/+$/, ''));
}

export function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) return next();
  if (!isAllowed(origin)) {
    if (req.method === 'OPTIONS') return res.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed' } });
    return next(forbidden('Origin is not allowed', 'ORIGIN_NOT_ALLOWED'));
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, Accept');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

/**
 * Rejects unsafe browser requests whose Origin (or fallback Referer) is not a
 * configured frontend origin. Requests without either header (CLI, tests,
 * native clients) are still subject to session CSRF validation.
 */
export function originGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    if (!isAllowed(origin)) return next(forbidden('Origin is not allowed', 'ORIGIN_NOT_ALLOWED'));
    return next();
  }
  const referer = req.headers.referer;
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (!isAllowed(refOrigin)) return next(forbidden('Origin is not allowed', 'ORIGIN_NOT_ALLOWED'));
    } catch {
      return next(forbidden('Invalid referer', 'ORIGIN_NOT_ALLOWED'));
    }
  }
  next();
}
