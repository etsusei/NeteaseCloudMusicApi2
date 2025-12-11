const express = require('express')
const router = express.Router()
const https = require('https')
const http = require('http')

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

  return new Promise((resolve) => {
    https.get(fallbackUrl, (res) => {
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
router.get('/url', async (req, res) => {
  const { id } = req.query

  if (!id) {
    return res.status(400).json({
      code: 400,
      msg: 'Missing id parameter',
      data: null
    })
  }

  console.log(`[Music] 获取歌曲 URL: ${id}`)

  // 1. 首先尝试 VIP 接口
  const vipResult = await getSongUrlInternal(id, req.cookies)
  if (vipResult.success) {
    console.log(`[Music] VIP接口成功: ${id}`)
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
})

// 代理下载接口 - 解决前端 CORS 跨域问题
router.get('/download', async (req, res) => {
  const { id, name } = req.query

  if (!id) {
    return res.status(400).json({
      code: 400,
      msg: 'Missing id parameter'
    })
  }

  console.log(`[Download] 开始下载: ${id}`)

  // 获取音频 URL
  let audioUrl = null
  let source = null

  // 1. 尝试 VIP 接口
  const vipResult = await getSongUrlInternal(id, req.cookies)
  if (vipResult.success) {
    audioUrl = vipResult.url
    source = vipResult.source
    console.log(`[Download] VIP接口成功: ${id}`)
  } else {
    // 2. 尝试第三方接口
    const fallbackResult = await getSongUrlFallback(id)
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
  const filename = name ? `${name}.mp3` : `${id}.mp3`
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
})

module.exports = router
