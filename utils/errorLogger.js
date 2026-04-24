const mongoose = require('mongoose');
const ErrorLog = require('../models/ErrorLog');

const MAX_STRING_LENGTH = 5000;
const SENSITIVE_KEYS = ['password', 'token', 'secret', 'authorization', 'otp'];

const trimString = (value) => {
  if (typeof value !== 'string') return value;
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`
    : value;
};

const safeClone = (value) => {
  if (value === undefined) return undefined;

  const seen = new WeakSet();

  try {
    return JSON.parse(JSON.stringify(value, (key, currentValue) => {
      if (key && SENSITIVE_KEYS.some((sensitiveKey) => key.toLowerCase().includes(sensitiveKey))) {
        return '[REDACTED]';
      }

      if (typeof currentValue === 'bigint') {
        return currentValue.toString();
      }

      if (typeof currentValue === 'function') {
        return `[Function: ${currentValue.name || 'anonymous'}]`;
      }

      if (typeof currentValue === 'string') {
        return trimString(currentValue);
      }

      if (currentValue && typeof currentValue === 'object') {
        if (seen.has(currentValue)) {
          return '[Circular]';
        }
        seen.add(currentValue);
      }

      return currentValue;
    }));
  } catch (error) {
    return trimString(String(value));
  }
};

const normalizeError = (error) => {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'string') {
    return new Error(error);
  }

  const serializedError = safeClone(error);
  return new Error(serializedError ? JSON.stringify(serializedError) : 'Unknown error');
};

const buildRequestPayload = (req) => {
  if (!req) return undefined;

  return {
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    ip: req.ip,
    userAgent: req.get ? req.get('user-agent') : undefined,
    params: safeClone(req.params),
    query: safeClone(req.query),
    body: safeClone(req.body),
    headers: safeClone({
      host: req.get ? req.get('host') : undefined,
      referer: req.get ? req.get('referer') : undefined,
      origin: req.get ? req.get('origin') : undefined
    })
  };
};

const logError = async (error, options = {}) => {
  const normalizedError = normalizeError(error);

  if (mongoose.connection.readyState !== 1) {
    console.error('Error log skipped because MongoDB is not connected:', normalizedError.message);
    return null;
  }

  try {
    return await ErrorLog.create({
      source: options.source || 'request',
      name: normalizedError.name || 'Error',
      message: trimString(normalizedError.message || 'Unknown error'),
      stack: trimString(normalizedError.stack),
      code: normalizedError.code ? String(normalizedError.code) : undefined,
      statusCode: typeof options.statusCode === 'number'
        ? options.statusCode
        : (typeof normalizedError.statusCode === 'number' ? normalizedError.statusCode : undefined),
      request: buildRequestPayload(options.req),
      metadata: safeClone(options.metadata),
      occurredAt: options.occurredAt || new Date()
    });
  } catch (logErrorInstance) {
    console.error('Failed to save error log:', logErrorInstance.message);
    return null;
  }
};

module.exports = {
  logError,
  safeClone
};
