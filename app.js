require('dotenv').config()
const fs = require('fs')
const path = require('path')
const express = require('express')
const bodyParser = require('body-parser')
const request = require('./util/request')
const packageJSON = require('./package.json')
const exec = require('child_process').exec
const cache = require('apicache').middleware

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

// CORS & Preflight request
app.use((req, res, next) => {
  if (req.path !== '/' && !req.path.includes('.')) {
    res.set({
      'Access-Control-Allow-Credentials': true,
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Headers': 'X-Requested-With,Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'PUT,POST,GET,DELETE,OPTIONS',
      'Content-Type': 'application/json; charset=utf-8'
    })
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

app.use('/api/auth', authRouter)
app.use('/api/playlists', playlistsRouter)
app.use('/api/export', exportRouter)
// ====================================================

// cache (只用于网易云音乐 API，不影响上面的用户 API)
app.use(cache('2 minutes', ((req, res) => res.statusCode === 200)))

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
        res.append('Set-Cookie', answer.cookie)
        res.status(answer.status).send(answer.body)
      })
      .catch(answer => {
        console.log('[ERR]', decodeURIComponent(req.originalUrl))
        if (answer.body.code == '301') answer.body.msg = '需要登录'
        res.append('Set-Cookie', answer.cookie)
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
