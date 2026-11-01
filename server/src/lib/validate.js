import { z } from 'zod';
import { AppError } from './errors.js';

const fieldErrors = (err) => {
  const out = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
};

export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    return next(new AppError(400, 'VALIDATION_ERROR', 'Please check the highlighted fields.', fieldErrors(result.error)));
  }
  if (source === 'query') {
    // Express query is a getter in some versions; assign via defineProperty fallback.
    try {
      req.validatedQuery = result.data;
    } catch {
      req.validatedQuery = result.data;
    }
  } else {
    req[source] = result.data;
  }
  next();
};

export const trimmed = (max) =>
  z.string().trim().min(1, 'Required').max(max, `Must be at most ${max} characters`);

export const optionalTrimmed = (max) =>
  z.string().trim().max(max).optional();

export const uuid = z.string().uuid('Invalid identifier');

export const pagination = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20)
};

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Username must be at least 3 characters')
  .max(30, 'Username must be at most 30 characters')
  .regex(/^[a-z0-9_]+$/, 'Use only lowercase letters, numbers and underscores')
  .refine((v) => !/^_|_$/.test(v), 'Username cannot start or end with an underscore')
  .refine((v) => !['admin', 'root', 'support', 'minchat', 'system', 'moderator'].includes(v), 'That username is reserved');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Display name is required')
  .max(60, 'Display name must be at most 60 characters')
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'Display name contains invalid characters');

export const bioSchema = z
  .string()
  .trim()
  .max(300, 'Bio must be at most 300 characters');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456789', '12345678', 'qwerty123',
  'letmein123', 'welcome123', 'admin123', 'iloveyou', 'changeme', 'messenger',
  'minchat123', 'password!', 'qwertyuiop'
]);

export function passwordIssues(password, context = {}) {
  const issues = [];
  if (typeof password !== 'string') return ['Password is required'];
  if (password.length < 10) issues.push('Use at least 10 characters');
  if (password.length > 128) issues.push('Use at most 128 characters');
  if (COMMON_PASSWORDS.has(password.toLowerCase())) issues.push('That password is too common');
  if (context.username && password.toLowerCase().includes(String(context.username).toLowerCase()))
    issues.push('Do not include your username in the password');
  if (context.email && password.toLowerCase().includes(String(context.email).split('@')[0].toLowerCase()))
    issues.push('Do not include your email name in the password');
  return issues;
}

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters');
