export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = 'Invalid request', code = 'BAD_REQUEST', details) =>
  new AppError(400, code, message, details);
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message);
export const forbidden = (message = 'You do not have permission to do that', code = 'FORBIDDEN') =>
  new AppError(403, code, message);
export const notFound = (message = 'Not found', code = 'NOT_FOUND') =>
  new AppError(404, code, message);
export const conflict = (message = 'Conflict', code = 'CONFLICT') =>
  new AppError(409, code, message);
export const tooMany = (message = 'Too many requests. Please slow down.', code = 'RATE_LIMITED') =>
  new AppError(429, code, message);
export const payloadTooLarge = (message = 'File is too large', code = 'PAYLOAD_TOO_LARGE') =>
  new AppError(413, code, message);

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
