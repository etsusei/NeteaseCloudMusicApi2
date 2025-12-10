const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../util/db');
const { generateToken, authMiddleware } = require('../util/auth');

const router = express.Router();

// 登录
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ code: 400, msg: '用户名和密码不能为空' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, password, is_admin FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ code: 401, msg: '用户名或密码错误' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ code: 401, msg: '用户名或密码错误' });
    }

    const token = generateToken(user);
    res.json({
      code: 200,
      msg: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          is_admin: user.is_admin
        }
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// 获取当前用户信息
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, is_admin, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '用户不存在' });
    }

    res.json({ code: 200, data: result.rows[0] });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// 修改用户信息
router.put('/profile', authMiddleware, async (req, res) => {
  const { username, password, newPassword } = req.body;

  try {
    // 验证当前密码
    const userResult = await pool.query(
      'SELECT password FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '用户不存在' });
    }

    const validPassword = await bcrypt.compare(password, userResult.rows[0].password);
    if (!validPassword) {
      return res.status(401).json({ code: 401, msg: '当前密码错误' });
    }

    // 更新用户名
    if (username && username !== req.user.username) {
      const existing = await pool.query(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [username, req.user.id]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ code: 400, msg: '用户名已被使用' });
      }
      await pool.query('UPDATE users SET username = $1 WHERE id = $2', [username, req.user.id]);
    }

    // 更新密码
    if (newPassword) {
      const newHash = await bcrypt.hash(newPassword, 10);
      await pool.query('UPDATE users SET password = $1 WHERE id = $2', [newHash, req.user.id]);
    }

    res.json({ code: 200, msg: '更新成功' });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

module.exports = router;
