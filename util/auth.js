const jwt = require('jsonwebtoken');

const JWT_SECRET = (process.env.JWT_SECRET || '').trim();
const JWT_EXPIRES_IN = '7d';

const AUTH_CODES = Object.freeze({
  REQUIRED: 'AUTH_REQUIRED',
  EXPIRED: 'TOKEN_EXPIRED',
  INVALID: 'TOKEN_INVALID'
});

if (!JWT_SECRET || JWT_SECRET === 'default-secret-change-me' || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to a strong random value of at least 32 characters');
}

// Generate JWT token
function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// Verify JWT token middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      code: 401,
      msg: '未登录',
      auth_code: AUTH_CODES.REQUIRED
    });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    const expired = err && err.name === 'TokenExpiredError';
    return res.status(401).json({
      code: 401,
      msg: expired ? '登录已过期' : '登录凭证无效',
      auth_code: expired ? AUTH_CODES.EXPIRED : AUTH_CODES.INVALID
    });
  }
}

// Verify admin permission middleware (requires authMiddleware first)
function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (!req.user || !req.user.is_admin) {
      return res.status(403).json({ code: 403, msg: '无管理员权限' });
    }
    next();
  });
}

module.exports = {
  generateToken,
  authMiddleware,
  adminMiddleware,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  AUTH_CODES
};
