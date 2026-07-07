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

const getCachedUrl = (key) => {
  const hit = urlCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.ts > URL_CACHE_TTL) {
    urlCache.delete(key)
    return null
  }
  return hit
}

const setCachedUrl = (key, data) => {
  // 简单 FIFO 淘汰，防止内存无限增长
  if (urlCache.size >= URL_CACHE_MAX) {
    urlCache.delete(urlCache.keys().next().value)
  }
  urlCache.set(key, { ...data, ts: Date.now() })
}

// 下载音质挡位：level 用于网易 eapi v1 接口和第三方接口，br 用于老版接口兜底
// rank 表示音质高低顺序，用于判断实际拿到的资源是否满足所选挡位
const QUALITY_LEVELS = {
  standard: { br: 128000, format: 'mp3', rank: 1 },
  higher: { br: 192000, format: 'mp3', rank: 2 },
  exhigh: { br: 320000, format: 'mp3', rank: 3 },
  lossless: { br: 999000, format: 'flac', rank: 4 },
  hires: { br: 999000, format: 'flac', rank: 5 }
}
const normalizeLevel = (level) => QUALITY_LEVELS[level] ? level : 'exhigh'

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

// 从音频 URL 的路径后缀推断格式（第三方接口不一定返回格式字段）
const inferFormatFromUrl = (url) => {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    if (pathname.endsWith('.flac')) return 'flac'
    if (pathname.endsWith('.mp3')) return 'mp3'
  } catch (e) { /* URL 解析失败就返回未知 */ }
  return null
}

// 内部调用 eapi v1 接口（使用 VIP Cookie），按 level 取源，支持无损/Hi-Res
const getSongUrlInternalV1 = async (id, cookies, level) => {
  const songUrlV1Module = require('../module/song_url_v1')
  const request = require('../util/request')

  try {
    // 克隆 cookie：v1 模块会改写 os/appver，避免污染 req.cookies 影响后续老接口调用
    const result = await songUrlV1Module({ id, level, cookie: { ...(cookies || {}) } }, request)
    const song = result.body && result.body.data && result.body.data[0]
    if (song && song.url) {
      return {
        success: true,
        url: song.url,
        source: 'netease-vip-v1',
        format: String(song.type || '').toLowerCase() || inferFormatFromUrl(song.url),
        br: Number(song.br) || null,
        level: song.level || null
      }
    }
  } catch (e) {
    const msg = e && (e.message || (e.body && e.body.msg)) || String(e)
    console.log('[Music] VIP v1接口失败:', msg)
  }
  return { success: false }
}

// 内部调用 /song/url 接口（使用 VIP Cookie）
const getSongUrlInternal = async (id, cookies, br = 320000) => {
  const songUrlModule = require('../module/song_url')
  const request = require('../util/request')

  try {
    const result = await songUrlModule({ id, br, cookie: cookies }, request)
    const song = result.body && result.body.data && result.body.data[0]
    if (song && song.url) {
      return {
        success: true,
        url: song.url,
        source: 'netease-vip',
        format: String(song.type || '').toLowerCase() || inferFormatFromUrl(song.url),
        br: Number(song.br) || null
      }
    }
  } catch (e) {
    console.log('[Music] VIP接口失败:', e.message)
  }
  return { success: false }
}

// 第三方 API fallback
const getSongUrlFallback = async (id, level = 'standard') => {
  const fallbackUrl = `https://api.kxzjoker.cn/api/163_music?url=https://y.music.163.com/m/song?id=${id}&level=${level}&type=json`

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
            // 第三方接口的 br 字段可能是 "320kbps" 这类字符串，也可能不存在
            let br = parseInt(json.br) || null
            if (br && br < 10000) br = br * 1000
            resolve({
              success: true,
              url: json.url,
              source: 'fallback-api',
              format: String(json.type || json.format || '').toLowerCase() || inferFormatFromUrl(json.url),
              br
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

// 判断实际拿到的资源是否满足请求的音质挡位
const isQualityMatched = (level, actual) => {
  const expected = QUALITY_LEVELS[level]
  // v1 接口会返回实际的音质等级，直接按等级排序判断
  if (actual.level && QUALITY_LEVELS[actual.level]) {
    return QUALITY_LEVELS[actual.level].rank >= expected.rank
  }
  if (!actual.format) return true // 格式未知时不阻拦，按可用处理
  if (expected.format === 'flac') {
    return actual.format === 'flac'
  }
  // mp3 挡位：拿到 flac 说明音质只高不低，视为满足
  if (actual.format !== 'mp3') return true
  if (!actual.br) return true
  return actual.br >= expected.br * 0.9
}

// 统一解析下载资源：eapi v1 优先(支持无损/Hi-Res)，其次老版 VIP 接口，最后第三方，结果带音质信息并缓存
const resolveDownloadSource = async (songId, level, cookies, useCache) => {
  const cacheKey = `dl|${songId}|${level}`
  if (useCache) {
    const cached = getCachedUrl(cacheKey)
    if (cached) return { ...cached, cached: true }
  }

  let result = await getSongUrlInternalV1(songId, cookies, level)
  if (!result.success) {
    result = await getSongUrlInternal(songId, cookies, QUALITY_LEVELS[level].br)
  }
  if (!result.success) {
    result = await getSongUrlFallback(songId, level)
  }
  if (!result.success) return { success: false }

  const resolved = {
    success: true,
    url: result.url,
    source: result.source,
    format: result.format || QUALITY_LEVELS[level].format,
    br: result.br,
    level: result.level || null,
    matched: isQualityMatched(level, result)
  }
  if (useCache) setCachedUrl(cacheKey, resolved)
  return resolved
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
    if (!hasOwnAccount) setCachedUrl(id, { url: vipResult.url, source: vipResult.source })
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
    if (!hasOwnAccount) setCachedUrl(id, { url: fallbackResult.url, source: fallbackResult.source })
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

// 下载预检接口：确认所选音质挡位是否有对应资源，供前端弹窗决定是否让用户重选
router.get('/download/check', asyncRoute(async (req, res) => {
  const songId = normalizeSongId(req.query.id)
  const level = normalizeLevel(req.query.level)

  if (!isValidSongId(songId)) {
    return res.status(400).json({ code: 400, msg: 'Invalid id parameter' })
  }

  const hasOwnAccount = (req.headers.cookie || '').includes('MUSIC_U')
  const result = await resolveDownloadSource(songId, level, req.cookies, !hasOwnAccount)

  if (!result.success) {
    console.log(`[Download] 预检失败: ${songId} (${level})`)
    return res.json({
      code: 404,
      msg: '无法获取歌曲资源',
      data: { available: false }
    })
  }

  console.log(`[Download] 预检成功: ${songId} (${level}) -> ${result.format || 'unknown'}/${result.br || '?'} matched=${result.matched}`)
  return res.json({
    code: 200,
    msg: 'success',
    data: {
      available: true,
      matched: result.matched,
      requested: { level, format: QUALITY_LEVELS[level].format },
      actual: {
        format: result.format,
        br: result.br,
        level: result.level,
        source: result.source
      }
    }
  })
}))

// 代理下载接口 - 解决前端 CORS 跨域问题
router.get('/download', asyncRoute(async (req, res) => {
  const { id, name } = req.query
  const songId = normalizeSongId(id)
  const level = normalizeLevel(req.query.level)

  if (!isValidSongId(songId)) {
    return res.status(400).json({
      code: 400,
      msg: 'Invalid id parameter'
    })
  }

  console.log(`[Download] 开始下载: ${id} (${level})`)

  const hasOwnAccount = (req.headers.cookie || '').includes('MUSIC_U')
  const resolved = await resolveDownloadSource(songId, level, req.cookies, !hasOwnAccount)

  if (!resolved.success) {
    console.log(`[Download] 获取URL失败: ${id}`)
    return res.status(404).json({
      code: 404,
      msg: '无法获取歌曲链接'
    })
  }
  console.log(`[Download] 资源来源: ${resolved.source}${resolved.cached ? '(缓存)' : ''}: ${id}`)

  // 按实际资源格式决定文件后缀和 Content-Type
  const isFlac = resolved.format === 'flac'
  const ext = isFlac ? 'flac' : 'mp3'
  const contentType = isFlac ? 'audio/flac' : 'audio/mpeg'

  // 设置下载文件名
  const filename = `${sanitizeDownloadName(name, songId)}.${ext}`
  const encodedFilename = encodeURIComponent(filename)

  try {
    // 解析URL
    const url = new URL(resolved.url)
    const protocol = url.protocol === 'https:' ? https : http

    // 代理请求音频文件
    const proxyReq = protocol.get(resolved.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://music.163.com/'
      }
    }, (proxyRes) => {
      // 设置响应头，触发浏览器下载
      res.setHeader('Content-Type', contentType)
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
