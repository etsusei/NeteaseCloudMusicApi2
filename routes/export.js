const express = require('express');
const pool = require('../util/db');
const { authMiddleware } = require('../util/auth');

const router = express.Router();

router.use(authMiddleware);

// 导出所有歌单
router.get('/', async (req, res) => {
  try {
    // 获取用户信息
    const userResult = await pool.query(
      'SELECT username FROM users WHERE id = $1',
      [req.user.id]
    );

    // 获取所有歌单
    const playlistsResult = await pool.query(
      'SELECT id, name, cover FROM playlists WHERE user_id = $1 ORDER BY created_at',
      [req.user.id]
    );

    const playlists = [];
    for (const playlist of playlistsResult.rows) {
      const songsResult = await pool.query(
        'SELECT song_id, song_name, artist, album, cover FROM playlist_songs WHERE playlist_id = $1 ORDER BY added_at',
        [playlist.id]
      );
      playlists.push({
        name: playlist.name,
        cover: playlist.cover,
        songs: songsResult.rows
      });
    }

    const exportData = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      username: userResult.rows[0] && userResult.rows[0].username,
      playlists
    };

    res.json({ code: 200, data: exportData });
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ code: 500, msg: '导出失败' });
  }
});

// 导入歌单
router.post('/', async (req, res) => {
  const { playlists } = req.body;

  if (!playlists || !Array.isArray(playlists)) {
    return res.status(400).json({ code: 400, msg: '无效的导入数据' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let importedCount = 0;
    for (const playlist of playlists) {
      if (!playlist.name) continue;

      // 创建歌单
      const playlistResult = await client.query(
        'INSERT INTO playlists (user_id, name, cover) VALUES ($1, $2, $3) RETURNING id',
        [req.user.id, playlist.name, playlist.cover || null]
      );
      const playlistId = playlistResult.rows[0].id;

      // 添加歌曲
      if (playlist.songs && Array.isArray(playlist.songs)) {
        for (const song of playlist.songs) {
          if (!song.song_id) continue;
          await client.query(
            `INSERT INTO playlist_songs (playlist_id, song_id, song_name, artist, album, cover) 
                         VALUES ($1, $2, $3, $4, $5, $6) 
                         ON CONFLICT (playlist_id, song_id) DO NOTHING`,
            [playlistId, song.song_id, song.song_name, song.artist, song.album, song.cover]
          );
        }
      }
      importedCount++;
    }

    await client.query('COMMIT');
    res.json({ code: 200, msg: `成功导入 ${importedCount} 个歌单` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Import error:', err);
    res.status(500).json({ code: 500, msg: '导入失败' });
  } finally {
    client.release();
  }
});

module.exports = router;
