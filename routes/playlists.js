const express = require('express');
const pool = require('../util/db');
const { authMiddleware } = require('../util/auth');

const router = express.Router();

// 所有歌单路由都需要认证
router.use(authMiddleware);

// 获取我的歌单列表
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, COUNT(ps.id) as song_count 
             FROM playlists p 
             LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id 
             WHERE p.user_id = $1 
             GROUP BY p.id 
             ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json({ code: 200, data: result.rows });
  } catch (err) {
    console.error('Get playlists error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// 创建歌单
router.post('/', async (req, res) => {
  const { name, cover } = req.body;

  if (!name) {
    return res.status(400).json({ code: 400, msg: '歌单名称不能为空' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO playlists (user_id, name, cover) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, name, cover || null]
    );
    res.json({ code: 200, msg: '创建成功', data: result.rows[0] });
  } catch (err) {
    console.error('Create playlist error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// 删除歌单
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM playlists WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '歌单不存在' });
    }

    res.json({ code: 200, msg: '删除成功' });
  } catch (err) {
    console.error('Delete playlist error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// 获取歌单歌曲
router.get('/:id/songs', async (req, res) => {
  const { id } = req.params;

  try {
    // 验证歌单所有权
    const playlist = await pool.query(
      'SELECT id FROM playlists WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (playlist.rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '歌单不存在' });
    }

    const result = await pool.query(
      'SELECT * FROM playlist_songs WHERE playlist_id = $1 ORDER BY added_at DESC',
      [id]
    );
    res.json({ code: 200, data: result.rows });
  } catch (err) {
    console.error('Get playlist songs error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// 添加歌曲到歌单
router.post('/:id/songs', async (req, res) => {
  const { id } = req.params;
  const { song_id, song_name, artist, album, cover } = req.body;

  if (!song_id) {
    return res.status(400).json({ code: 400, msg: '歌曲ID不能为空' });
  }

  try {
    // 验证歌单所有权
    const playlist = await pool.query(
      'SELECT id, cover FROM playlists WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (playlist.rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '歌单不存在' });
    }

    // 添加歌曲
    await pool.query(
      `INSERT INTO playlist_songs (playlist_id, song_id, song_name, artist, album, cover) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             ON CONFLICT (playlist_id, song_id) DO NOTHING`,
      [id, song_id, song_name, artist, album, cover]
    );

    // 如果歌单没有封面，使用第一首歌的封面
    if (!playlist.rows[0].cover && cover) {
      await pool.query('UPDATE playlists SET cover = $1 WHERE id = $2', [cover, id]);
    }

    res.json({ code: 200, msg: '添加成功' });
  } catch (err) {
    console.error('Add song error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

// 从歌单删除歌曲
router.delete('/:id/songs/:songId', async (req, res) => {
  const { id, songId } = req.params;

  try {
    // 验证歌单所有权
    const playlist = await pool.query(
      'SELECT id FROM playlists WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (playlist.rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '歌单不存在' });
    }

    await pool.query(
      'DELETE FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2',
      [id, songId]
    );

    res.json({ code: 200, msg: '删除成功' });
  } catch (err) {
    console.error('Delete song error:', err);
    res.status(500).json({ code: 500, msg: '服务器错误' });
  }
});

module.exports = router;
