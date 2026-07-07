const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../util/db');
const { adminMiddleware } = require('../util/auth');

const router = express.Router();

// 所有管理路由都需要管理员权限
router.use(adminMiddleware);

// ========== 统计 ==========

// 概览统计
router.get('/stats', async (req, res) => {
  try {
    const [counts, userTrend, playlistTrend, topSongs, topArtists, recentUsers] = await Promise.all([
      pool.query(`SELECT
        (SELECT COUNT(*) FROM users) AS user_count,
        (SELECT COUNT(*) FROM playlists) AS playlist_count,
        (SELECT COUNT(*) FROM playlist_songs) AS song_count,
        (SELECT COUNT(*) FROM users WHERE is_admin) AS admin_count`),
      pool.query(
        `SELECT DATE(created_at) AS date, COUNT(*) AS count
         FROM users
         WHERE created_at >= NOW() - INTERVAL '30 days'
         GROUP BY DATE(created_at) ORDER BY date`
      ),
      pool.query(
        `SELECT DATE(created_at) AS date, COUNT(*) AS count
         FROM playlists
         WHERE created_at >= NOW() - INTERVAL '30 days'
         GROUP BY DATE(created_at) ORDER BY date`
      ),
      pool.query(
        `SELECT song_id, MAX(song_name) AS song_name, MAX(artist) AS artist, MAX(cover) AS cover, COUNT(*) AS count
         FROM playlist_songs
         GROUP BY song_id ORDER BY count DESC, song_id LIMIT 10`
      ),
      pool.query(
        `SELECT artist, COUNT(*) AS count
         FROM playlist_songs
         WHERE artist IS NOT NULL AND artist != ''
         GROUP BY artist ORDER BY count DESC, artist LIMIT 10`
      ),
      pool.query(
        `SELECT id, username, is_admin, created_at
         FROM users ORDER BY created_at DESC LIMIT 5`
      )
    ]);

    res.json({
      code: 200,
      data: {
        counts: counts.rows[0],
        user_trend: userTrend.rows,
        playlist_trend: playlistTrend.rows,
        top_songs: topSongs.rows,
        top_artists: topArtists.rows,
        recent_users: recentUsers.rows
      }
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// ========== 用户管理 ==========

// 用户列表（分页 + 搜索）
router.get('/users', async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 10, 1), 100);
  const search = (req.query.search || '').trim();

  try {
    const where = search ? 'WHERE u.username ILIKE $3' : '';
    const params = [pageSize, (page - 1) * pageSize];
    if (search) params.push(`%${search}%`);

    const [list, total] = await Promise.all([
      pool.query(
        `SELECT u.id, u.username, u.is_admin, u.created_at, COUNT(p.id) AS playlist_count
         FROM users u
         LEFT JOIN playlists p ON p.user_id = u.id
         ${where}
         GROUP BY u.id
         ORDER BY u.id
         LIMIT $1 OFFSET $2`,
        params
      ),
      pool.query(
        `SELECT COUNT(*) FROM users u ${where.replace('$3', '$1')}`,
        search ? [`%${search}%`] : []
      )
    ]);

    res.json({
      code: 200,
      data: { list: list.rows, total: parseInt(total.rows[0].count, 10), page, pageSize }
    });
  } catch (err) {
    console.error('Admin list users error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// 创建用户
router.post('/users', async (req, res) => {
  const { username, password, is_admin } = req.body;

  if (!username || !password) {
    return res.status(400).json({ code: 400, msg: '用户名和密码不能为空' });
  }
  if (username.length > 50) {
    return res.status(400).json({ code: 400, msg: '用户名不能超过50个字符' });
  }
  if (password.length < 6) {
    return res.status(400).json({ code: 400, msg: '密码至少6个字符' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ code: 400, msg: '用户名已被使用' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password, is_admin) VALUES ($1, $2, $3) RETURNING id, username, is_admin, created_at',
      [username, hash, !!is_admin]
    );
    res.json({ code: 200, msg: '创建成功', data: result.rows[0] });
  } catch (err) {
    console.error('Admin create user error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// 更新用户（重置密码 / 设置管理员）
router.put('/users/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { password, is_admin } = req.body;

  if (!Number.isInteger(id)) {
    return res.status(400).json({ code: 400, msg: '无效的用户ID' });
  }

  try {
    const existing = await pool.query('SELECT id, is_admin FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '用户不存在' });
    }

    if (typeof is_admin === 'boolean') {
      if (id === req.user.id && !is_admin) {
        return res.status(400).json({ code: 400, msg: '不能撤销自己的管理员权限' });
      }
      await pool.query('UPDATE users SET is_admin = $1 WHERE id = $2', [is_admin, id]);
    }

    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ code: 400, msg: '密码至少6个字符' });
      }
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hash, id]);
    }

    res.json({ code: 200, msg: '更新成功' });
  } catch (err) {
    console.error('Admin update user error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// 删除用户（级联删除其所有歌单）
router.delete('/users/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ code: 400, msg: '无效的用户ID' });
  }
  if (id === req.user.id) {
    return res.status(400).json({ code: 400, msg: '不能删除自己' });
  }

  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '用户不存在' });
    }
    res.json({ code: 200, msg: '删除成功' });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// ========== 歌单管理 ==========

// 全部歌单列表（分页 + 搜索 + 按用户筛选）
router.get('/playlists', async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 10, 1), 100);
  const search = (req.query.search || '').trim();
  const userId = parseInt(req.query.user_id, 10);

  try {
    const conditions = [];
    const filterParams = [];
    if (search) {
      filterParams.push(`%${search}%`);
      conditions.push(`p.name ILIKE $${filterParams.length}`);
    }
    if (Number.isInteger(userId)) {
      filterParams.push(userId);
      conditions.push(`p.user_id = $${filterParams.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [list, total] = await Promise.all([
      pool.query(
        `SELECT p.id, p.name, p.cover, p.created_at, p.user_id,
                u.username AS owner, COUNT(ps.id) AS song_count
         FROM playlists p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN playlist_songs ps ON ps.playlist_id = p.id
         ${where}
         GROUP BY p.id, u.username
         ORDER BY p.created_at DESC
         LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
        [...filterParams, pageSize, (page - 1) * pageSize]
      ),
      pool.query(`SELECT COUNT(*) FROM playlists p ${where}`, filterParams)
    ]);

    res.json({
      code: 200,
      data: { list: list.rows, total: parseInt(total.rows[0].count, 10), page, pageSize }
    });
  } catch (err) {
    console.error('Admin list playlists error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// 歌单详情（含歌曲列表）
router.get('/playlists/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ code: 400, msg: '无效的歌单ID' });
  }

  try {
    const playlist = await pool.query(
      `SELECT p.id, p.name, p.cover, p.created_at, p.user_id, u.username AS owner
       FROM playlists p JOIN users u ON u.id = p.user_id
       WHERE p.id = $1`,
      [id]
    );
    if (playlist.rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '歌单不存在' });
    }

    const songs = await pool.query(
      'SELECT * FROM playlist_songs WHERE playlist_id = $1 ORDER BY added_at DESC',
      [id]
    );
    res.json({ code: 200, data: { ...playlist.rows[0], songs: songs.rows } });
  } catch (err) {
    console.error('Admin playlist detail error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// 删除歌单
router.delete('/playlists/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ code: 400, msg: '无效的歌单ID' });
  }

  try {
    const result = await pool.query('DELETE FROM playlists WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '歌单不存在' });
    }
    res.json({ code: 200, msg: '删除成功' });
  } catch (err) {
    console.error('Admin delete playlist error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// 从歌单移除歌曲
router.delete('/playlists/:id/songs/:songId', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { songId } = req.params;

  if (!Number.isInteger(id)) {
    return res.status(400).json({ code: 400, msg: '无效的歌单ID' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2 RETURNING id',
      [id, songId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '歌曲不存在' });
    }
    res.json({ code: 200, msg: '删除成功' });
  } catch (err) {
    console.error('Admin delete song error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

module.exports = router;
