const jwt = require('jsonwebtoken');

const JWT_SECRET = (process.env.JWT_SECRET || '').trim();
const JWT_EXPIRES_IN = '7d';

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
    return res.status(401).json({ code: 401, msg: '未登录' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ code: 401, msg: '登录已过期' });
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

module.exports = { generateToken, authMiddleware, adminMiddleware, JWT_SECRET };
