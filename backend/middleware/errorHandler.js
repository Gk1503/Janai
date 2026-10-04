export function notFound(req, res, next) {
  res.status(404);
  next(new Error(`Not found: ${req.method} ${req.originalUrl}`));
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.statusCode || (error.name === 'ValidationError' || error.name === 'CastError' ? 400 : error.code === 11000 ? 409 : res.statusCode >= 400 ? res.statusCode : 500);
  const message = error.code === 11000 ? 'A record with that value already exists.' : error.message || 'Unexpected server error.';
  if (status >= 500) console.error('API error:', error.name || 'Error');
  return res.status(status).json({ message });
}
