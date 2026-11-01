import pino from 'pino';
import { config } from './config.js';

const transport = !config.isProduction
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' } }
  : undefined;

export const logger = pino({
  level: config.logLevel,
  transport,
  base: { service: 'minchat', env: config.env },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'token',
      'csrfToken',
      '*.password',
      '*.token',
      '*.csrfToken',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword'
    ],
    censor: '[redacted]'
  }
});
