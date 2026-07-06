require('dotenv').config()
const fs = require('fs')
const path = require('path')
const express = require('express')
const compression = require('compression')
const bodyParser = require('body-parser')
const request = require('./util/request')
const packageJSON = require('./package.json')
const exec = require('child_process').exec
const apicache = require('apicache')
// ACAO 是按请求 Origin 反射的，绝不能进缓存：否则先来的 origin 会把自己的 ACAO
// 存进缓存，TTL 内其他合法 origin 拿到不匹配的头被浏览器拦截。
// 拉黑后缓存命中时保留上游 CORS 中间件刚设置的新鲜值。
apicache.options({ headerBlacklist: ['access-control-allow-origin'] })
const cache = apicache.middleware

const normalizeOrigin = (value) => {
  if (!value) return null
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).origin
  } catch (e) {
    return null
  }
}

const ALLOWED_ORIGINS = (process.env.FRONTEND_ORIGINS || 'https://ne0n.zeabur.app')
  .split(',')
  .map(origin => normalizeOrigin(origin.trim()))
  .filter(Boolean)

// 本地/局域网开发来源自动放行：dev server 的 IP/端口经常变，逐个加进 FRONTEND_ORIGINS 不现实。
// 鉴权走 Authorization 头（前端 localStorage 存 JWT），不依赖 Cookie，放行私网来源的 CSRF 风险可控。
const PRIVATE_DEV_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/
const isPrivateDevOrigin = (origin) => PRIVATE_DEV_ORIGIN_RE.test(origin || '')

// VIP Cookie 配置
const VIP_COOKIE = process.env.VIP_COOKIE || ''
if (VIP_COOKIE) {
  console.log('[VIP] 已加载黑胶VIP Cookie')
} else {
  console.log('[VIP] 未配置VIP Cookie，部分歌曲可能只能试听30秒')
}

// version check
exec('npm info NeteaseCloudMusicApi version', (err, stdout, stderr) => {
  if (!err) {
    let version = stdout.trim()
    if (packageJSON.version < version) {
      console.log(`最新版本: ${version}, 当前版本: ${packageJSON.version}, 请及时更新`)
    }
  }
})

const app = express()
app.set('trust proxy', 1)

// gzip/brotli 压缩 - 大幅缩小 song/detail 等大响应体积，提升弱网(尤其大陆访问东京)存活率
// 必须放在所有会产生响应的中间件之前
app.use(compression())

// CORS & Preflight request
app.use((req, res, next) => {
  if (req.path !== '/' && !req.path.includes('.')) {
    const requestOrigin = normalizeOrigin(req.headers.origin)
    const refererOrigin = normalizeOrigin(req.headers.referer)
    const incomingOrigin = requestOrigin || refererOrigin

    if (incomingOrigin && !ALLOWED_ORIGINS.includes(incomingOrigin) && !isPrivateDevOrigin(incomingOrigin)) {
      return res.status(403).json({
        code: 403,
        msg: 'Forbidden origin'
      })
    }

    res.set({
      'Access-Control-Allow-Credentials': true,
      'Access-Control-Allow-Headers': 'X-Requested-With,Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'PUT,POST,GET,DELETE,OPTIONS',
      // 让浏览器缓存 preflight 结果 24h：带 Authorization 的请求不用每次都先跑一趟 OPTIONS
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
      'Content-Type': 'application/json; charset=utf-8'
    })

    if (requestOrigin) {
      res.set('Access-Control-Allow-Origin', requestOrigin)
    }
  }
  req.method === 'OPTIONS' ? res.status(204).end() : next()
})

// cookie parser - 自动注入 VIP Cookie
app.use((req, res, next) => {
  req.cookies = {}

  // 优先使用 VIP Cookie，如果用户也传了自己的 cookie 则合并
  const cookieString = req.headers.cookie || ''
  const vipCookieString = VIP_COOKIE || ''

  // 先解析 VIP Cookie（作为基础）
  vipCookieString.split(/\s*;\s*/).forEach(pair => {
    let crack = pair.indexOf('=')
    if (crack < 1 || crack == pair.length - 1) return
    req.cookies[decodeURIComponent(pair.slice(0, crack)).trim()] = decodeURIComponent(pair.slice(crack + 1)).trim()
  })

  // 再解析用户 Cookie（如果有的话，会覆盖 VIP Cookie）
  cookieString.split(/\s*;\s*/).forEach(pair => {
    let crack = pair.indexOf('=')
    if (crack < 1 || crack == pair.length - 1) return
    req.cookies[decodeURIComponent(pair.slice(0, crack)).trim()] = decodeURIComponent(pair.slice(crack + 1)).trim()
  })

  next()
})

// body parser
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))

// ========== 用户认证和歌单 API (不使用缓存) ==========
const authRouter = require('./routes/auth')
const playlistsRouter = require('./routes/playlists')
const exportRouter = require('./routes/export')
const musicRouter = require('./routes/music')

app.use('/api/auth', authRouter)
app.use('/api/playlists', playlistsRouter)
app.use('/api/export', exportRouter)
app.use('/api/music', musicRouter)
// ====================================================

// cache (只用于网易云音乐 API，不影响上面的用户 API)
// 分级：song/detail、lyric、album 这类内容基本不变 → 服务端缓存 30 分钟；
// 其余(搜索、榜单、song/url 等)维持 2 分钟短缓存。
// apicache 会自动在响应加 cache-control: max-age=<剩余TTL>，浏览器/CDN 同样受益。
const onlyOk = (req, res) => res.statusCode === 200
const shortCache = cache('2 minutes', onlyOk)
const longCache = cache('30 minutes', onlyOk)
// 注意必须精确匹配：/album 前缀匹配会误伤 /album/sub(收藏操作) 等路由
const LONG_CACHE_PATHS = ['/song/detail', '/lyric', '/album', '/artist/album']
app.use((req, res, next) => {
  const middleware = LONG_CACHE_PATHS.includes(req.path) ? longCache : shortCache
  return middleware(req, res, next)
})

// static
app.use(express.static(path.join(__dirname, 'public')))


// 代理路由 - 伪造请求头获取第三方音乐 URL
app.get('/proxy', async (req, res) => {
  const id = req.query.id

  if (!id) {
    return res.status(400).json({
      code: 400,
      msg: 'Missing id parameter',
      url: null
    })
  }

  const targetUrl = `https://fy-musicbox-api.mu-jie.cc/meting/?server=netease&type=url&id=${id}`

  try {
    const https = require('https')
    const { URL } = require('url')

    // 发起请求并跟随重定向
    const fetchWithRedirect = (urlString, maxRedirects = 10) => {
      return new Promise((resolve, reject) => {
        const urlObj = new URL(urlString)

        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || 443,
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          headers: {
            'Referer': 'https://mu-jie.cc/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
            'Accept': '*/*',
          }
        }

        const request = https.request(options, (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            if (maxRedirects > 0) {
              // 处理相对路径重定向
              let redirectUrl = response.headers.location
              if (!redirectUrl.startsWith('http')) {
                redirectUrl = `https://${urlObj.hostname}${redirectUrl}`
              }
              resolve(fetchWithRedirect(redirectUrl, maxRedirects - 1))
            } else {
              reject(new Error('Too many redirects'))
            }
          } else {
            resolve({
              url: urlString,
              statusCode: response.statusCode
            })
          }
        })

        request.on('error', reject)
        request.end()
      })
    }

    const result = await fetchWithRedirect(targetUrl)

    res.json({
      code: result.statusCode,
      url: result.url,
      id: id
    })

  } catch (error) {
    res.status(500).json({
      code: 500,
      msg: error.message,
      url: null
    })
  }
})

// router
const special = {
  'daily_signin.js': '/daily_signin',
  'fm_trash.js': '/fm_trash',
  'personal_fm.js': '/personal_fm'
}

fs.readdirSync(path.join(__dirname, 'module')).reverse().forEach(file => {
  if (!file.endsWith('.js')) return
  let route = (file in special) ? special[file] : '/' + file.replace(/\.js$/i, '').replace(/_/g, '/')
  let question = require(path.join(__dirname, 'module', file))

  app.use(route, (req, res) => {
    let query = Object.assign({}, req.query, req.body, { cookie: req.cookies })
    question(query, request)
      .then(answer => {
        console.log('[OK]', decodeURIComponent(req.originalUrl))
        res.status(answer.status).send(answer.body)
      })
      .catch(answer => {
        console.log('[ERR]', decodeURIComponent(req.originalUrl))
        if (answer.body.code == '301') answer.body.msg = '需要登录'
        res.status(answer.status).send(answer.body)
      })
  })
})

const port = process.env.PORT || 3000
const host = process.env.HOST || ''

app.server = app.listen(port, host, () => {
  console.log(`server running @ http://${host ? host : 'localhost'}:${port}`)
})

module.exports = app
