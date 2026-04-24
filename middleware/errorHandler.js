const { formatLambdaResponse } = require('../utils/helpers');
const { logError } = require('../utils/errorLogger');

/**
 * Global error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  console.error('Error occurred:', err);

  // Default error response
  let statusCode = 500;
  let message = 'Internal Server Error';

  // Handle specific error types
  if (err && (err.type === 'entity.parse.failed' || (err.name === 'SyntaxError' && err.statusCode === 400))) {
    statusCode = 400;
    message = 'Invalid JSON body';
  } else if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600) {
    statusCode = err.statusCode;
  }
  if (err.code === 'ENOTFOUND') {
    statusCode = 404;
    message = 'Domain not found';
  } else if (err.code === 'ECONNREFUSED') {
    statusCode = 503;
    message = 'Connection refused';
  } else if (err.code === 'ETIMEDOUT') {
    statusCode = 408;
    message = 'Request timeout';
  } else if (err.response) {
    statusCode = err.response.status || 500;
    message = err.response.statusText || 'Request failed';
  } else if (err.message) {
    message = err.message;
  }

  // Send Lambda-formatted error response
  const errorResponse = formatLambdaResponse(statusCode, {
    error: message,
    code: err.code || 'UNKNOWN_ERROR',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  void logError(err, {
    source: 'request',
    req,
    statusCode,
    metadata: {
      responseMessage: message
    }
  });

  if (res.headersSent) {
    return next(err);
  }

  res.status(statusCode).json(errorResponse);
};

/**
 * 404 Not Found handler
 */
const notFoundHandler = (req, res) => {
  const response = formatLambdaResponse(404, {
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });

  res.status(404).json(response);
};

module.exports = {
  errorHandler,
  notFoundHandler
};
