const express = require('express')
const router = express.Router()
const https = require('https')
const http = require('http')

// 复用到第三方 API 的 TLS 连接，避免每次获取歌曲 URL 都重新握手
const keepAliveAgent = new https.Agent({ keepAlive: true })

// 歌曲 URL 内存缓存：网易返回的播放链接有时效(约 20 分钟)，缓存 10 分钟内安全。
// 配合前端"快播完时预取下一首"，切歌可以做到基本无缝。
const URL_CACHE_TTL = 10 * 60 * 1000
const URL_CACHE_MAX = 500
const urlCache = new Map()

const getCachedUrl = (id) => {
  const hit = urlCache.get(id)
  if (!hit) return null
  if (Date.now() - hit.ts > URL_CACHE_TTL) {
    urlCache.delete(id)
    return null
  }
  return hit
}

const setCachedUrl = (id, url, source) => {
  // 简单 FIFO 淘汰，防止内存无限增长
  if (urlCache.size >= URL_CACHE_MAX) {
    urlCache.delete(urlCache.keys().next().value)
  }
  urlCache.set(id, { url, source, ts: Date.now() })
}

const normalizeSongId = (id) => String(id || '').trim()
const isValidSongId = (id) => /^\d{1,20}$/.test(id)
const sanitizeDownloadName = (name, fallback) => {
  const value = String(name || fallback || 'song')
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 120)
  return value || String(fallback || 'song')
}
const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next)
}

// 内部调用 /song/url 接口（使用 VIP Cookie）
const getSongUrlInternal = async (id, cookies) => {
  const songUrlModule = require('../module/song_url')
  const request = require('../util/request')

  try {
    const result = await songUrlModule({ id, br: 320000, cookie: cookies }, request)
    if (result.body && result.body.data && result.body.data[0] && result.body.data[0].url) {
      return {
        success: true,
        url: result.body.data[0].url,
        source: 'netease-vip'
      }
    }
  } catch (e) {
    console.log('[Music] VIP接口失败:', e.message)
  }
  return { success: false }
}

// 第三方 API fallback
const getSongUrlFallback = async (id) => {
  const fallbackUrl = `https://api.kxzjoker.cn/api/163_music?url=https://y.music.163.com/m/song?id=${id}&level=standard&type=json`

  // 注意：老版 agent-base(socks-proxy-agent 依赖)全局补丁过 https.get，
  // 不支持 (url, options, cb) 三参数写法，必须用 options 对象形式
  const u = new URL(fallbackUrl)
  return new Promise((resolve) => {
    https.get({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      agent: keepAliveAgent
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json && json.url) {
            resolve({
              success: true,
              url: json.url,
              source: 'fallback-api'
            })
          } else {
            resolve({ success: false })
          }
        } catch (e) {
          resolve({ success: false })
        }
      })
    }).on('error', () => {
      resolve({ success: false })
    })
  })
}

// 统一的音乐 URL 获取接口
router.get('/url', asyncRoute(async (req, res) => {
  const id = normalizeSongId(req.query.id)

  if (!isValidSongId(id)) {
    return res.status(400).json({
      code: 400,
      msg: 'Invalid id parameter',
      data: null
    })
  }

  console.log(`[Music] 获取歌曲 URL: ${id}`)

  // 0. 命中内存缓存直接返回（用户自带 MUSIC_U 登录态时跳过，避免串号）
  const hasOwnAccount = (req.headers.cookie || '').includes('MUSIC_U')
  if (!hasOwnAccount) {
    const cached = getCachedUrl(id)
    if (cached) {
      console.log(`[Music] 缓存命中: ${id}`)
      return res.json({
        code: 200,
        msg: 'success',
        data: { url: cached.url, id: id, source: cached.source + '-cached' }
      })
    }
  }

  // 1. 首先尝试 VIP 接口
  const vipResult = await getSongUrlInternal(id, req.cookies)
  if (vipResult.success) {
    console.log(`[Music] VIP接口成功: ${id}`)
    if (!hasOwnAccount) setCachedUrl(id, vipResult.url, vipResult.source)
    return res.json({
      code: 200,
      msg: 'success',
      data: {
        url: vipResult.url,
        id: id,
        source: vipResult.source
      }
    })
  }

  // 2. VIP 失败，尝试第三方 fallback
  console.log(`[Music] 尝试第三方接口: ${id}`)
  const fallbackResult = await getSongUrlFallback(id)
  if (fallbackResult.success) {
    console.log(`[Music] 第三方接口成功: ${id}`)
    if (!hasOwnAccount) setCachedUrl(id, fallbackResult.url, fallbackResult.source)
    return res.json({
      code: 200,
      msg: 'success',
      data: {
        url: fallbackResult.url,
        id: id,
        source: fallbackResult.source
      }
    })
  }

  // 3. 都失败了
  console.log(`[Music] 所有接口都失败: ${id}`)
  return res.json({
    code: 404,
    msg: '无法获取歌曲链接',
    data: null
  })
}))

// 代理下载接口 - 解决前端 CORS 跨域问题
router.get('/download', asyncRoute(async (req, res) => {
  const { id, name } = req.query
  const songId = normalizeSongId(id)

  if (!isValidSongId(songId)) {
    return res.status(400).json({
      code: 400,
      msg: 'Invalid id parameter'
    })
  }

  console.log(`[Download] 开始下载: ${id}`)

  // 获取音频 URL
  let audioUrl = null
  let source = null

  // 1. 尝试 VIP 接口
  const vipResult = await getSongUrlInternal(songId, req.cookies)
  if (vipResult.success) {
    audioUrl = vipResult.url
    source = vipResult.source
    console.log(`[Download] VIP接口成功: ${id}`)
  } else {
    // 2. 尝试第三方接口
    const fallbackResult = await getSongUrlFallback(songId)
    if (fallbackResult.success) {
      audioUrl = fallbackResult.url
      source = fallbackResult.source
      console.log(`[Download] 第三方接口成功: ${id}`)
    }
  }

  if (!audioUrl) {
    console.log(`[Download] 获取URL失败: ${id}`)
    return res.status(404).json({
      code: 404,
      msg: '无法获取歌曲链接'
    })
  }

  // 设置下载文件名
  const filename = `${sanitizeDownloadName(name, songId)}.mp3`
  const encodedFilename = encodeURIComponent(filename)

  try {
    // 解析URL
    const url = new URL(audioUrl)
    const protocol = url.protocol === 'https:' ? https : http

    // 代理请求音频文件
    const proxyReq = protocol.get(audioUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://music.163.com/'
      }
    }, (proxyRes) => {
      // 设置响应头，触发浏览器下载
      res.setHeader('Content-Type', 'audio/mpeg')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`)

      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length'])
      }

      // 流式传输
      proxyRes.pipe(res)

      proxyRes.on('error', (err) => {
        console.error('[Download] 流传输出错:', err)
        if (!res.headersSent) {
          res.status(500).json({ code: 500, msg: '下载失败' })
        }
      })
    })

    proxyReq.on('error', (err) => {
      console.error('[Download] 请求出错:', err)
      res.status(500).json({ code: 500, msg: '下载失败' })
    })

  } catch (err) {
    console.error('[Download] 异常:', err)
    res.status(500).json({ code: 500, msg: '下载失败' })
  }
}))

router.use((err, req, res, next) => {
  console.error('[Music] Route error:', err)
  if (res.headersSent) return next(err)
  res.status(500).json({
    code: 500,
    msg: 'Music service error',
    data: null
  })
})

module.exports = router
