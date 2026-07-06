function createRateLimiter(options) {
  const windowMs = options.windowMs;
  const max = options.max;
  const message = options.message || { code: 429, msg: 'Too many requests' };
  const hits = new Map();

  const getClientKey = (req) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) return String(forwardedFor).split(',')[0].trim();
    return req.ip || req.connection.remoteAddress || 'unknown';
  };

  return (req, res, next) => {
    const now = Date.now();
    const key = getClientKey(req);
    const current = hits.get(key);

    if (!current || now > current.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > max) {
      res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).json(message);
    }

    next();
  };
}

module.exports = createRateLimiter;
