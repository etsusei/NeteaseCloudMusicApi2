const encrypt = require('./crypto')
const queryString = require('querystring')
const zlib = require('zlib')

const chooseUserAgent = ua => {
  const userAgentList = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1',
    'Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 5.1.1; Nexus 6 Build/LYZ28E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_2 like Mac OS X) AppleWebKit/603.2.4 (KHTML, like Gecko) Mobile/14F89;GameHelper',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 10_0 like Mac OS X) AppleWebKit/602.1.38 (KHTML, like Gecko) Version/10.0 Mobile/14A300 Safari/602.1',
    'Mozilla/5.0 (iPad; CPU OS 10_0 like Mac OS X) AppleWebKit/602.1.38 (KHTML, like Gecko) Version/10.0 Mobile/14A300 Safari/602.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.12; rv:46.0) Gecko/20100101 Firefox/46.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_5) AppleWebKit/603.2.4 (KHTML, like Gecko) Version/10.1.1 Safari/603.2.4',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:46.0) Gecko/20100101 Firefox/46.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/13.10586'
  ]
  let index = 0
  if (typeof ua == 'undefined') index = Math.floor(Math.random() * userAgentList.length)
  else if (ua === 'mobile') index = Math.floor(Math.random() * 7)
  else if (ua === 'pc') index = Math.floor(Math.random() * 5) + 8
  else return ua
  return userAgentList[index]
}

const splitSetCookie = value => {
  if (!value) return []
  return value.split(/,(?=\s*[^;,]+=)/g)
}

const getSetCookieHeaders = headers => {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  return splitSetCookie(headers.get('set-cookie'))
}

const createRequest = (method, url, data = {}, options = {}) => {
  return new Promise((resolve, reject) => {
    let headers = { 'User-Agent': chooseUserAgent(options.ua) }
    if (method.toUpperCase() === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    if (url.includes('music.163.com')) headers['Referer'] = 'https://music.163.com'
    headers['X-Real-IP'] = '118.88.88.88'

    if (typeof options.cookie === 'object') {
      headers['Cookie'] = Object.keys(options.cookie)
        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(options.cookie[key]))
        .join('; ')
    } else if (options.cookie) {
      headers['Cookie'] = options.cookie
    }

    if (options.crypto === 'weapi') {
      let csrfToken = (headers['Cookie'] || '').match(/_csrf=([^(;|$)]+)/)
      data.csrf_token = csrfToken ? csrfToken[1] : ''
      data = encrypt.weapi(data)
      url = url.replace(/\w*api/, 'weapi')
    } else if (options.crypto === 'linuxapi') {
      data = encrypt.linuxapi({
        method: method,
        url: url.replace(/\w*api/, 'api'),
        params: data
      })
      headers['User-Agent'] =
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36'
      url = 'https://music.163.com/api/linux/forward'
    } else if (options.crypto === 'eapi') {
      const cookie = options.cookie || {}
      const csrfToken = cookie['__csrf'] || ''
      const header = {
        osver: cookie.osver,
        deviceId: cookie.deviceId,
        appver: cookie.appver || '6.1.1',
        versioncode: cookie.versioncode || '140',
        mobilename: cookie.mobilename,
        buildver: cookie.buildver || Date.now().toString().substr(0, 10),
        resolution: cookie.resolution || '1920x1080',
        __csrf: csrfToken,
        os: cookie.os || 'android',
        channel: cookie.channel,
        requestId: `${Date.now()}_${Math.floor(Math.random() * 1000).toString().padStart(4, '0')}`
      }
      if (cookie.MUSIC_U) header['MUSIC_U'] = cookie.MUSIC_U
      if (cookie.MUSIC_A) header['MUSIC_A'] = cookie.MUSIC_A
      headers['Cookie'] = Object.keys(header)
        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(header[key]))
        .join('; ')
      data.header = header
      data = encrypt.eapi(options.url, data)
      url = url.replace(/\w*api/, 'eapi')
    }

    const answer = { status: 500, body: {}, cookie: [] }
    if (options.proxy) {
      answer.status = 400
      answer.body = { code: 400, msg: 'Proxy requests are not supported' }
      return reject(answer)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const fetchOptions = {
      method: method,
      headers: headers,
      signal: controller.signal
    }
    if (!/^(GET|HEAD)$/i.test(method)) {
      fetchOptions.body = queryString.stringify(data)
    }

    fetch(url, fetchOptions)
      .then(async res => {
        clearTimeout(timeout)
        const rawBody = Buffer.from(await res.arrayBuffer())
        const body = options.crypto === 'eapi' ? rawBody : rawBody.toString()

        answer.cookie = getSetCookieHeaders(res.headers).map(x =>
          x.replace(/\s*Domain=[^(;|$)]+;*/, '')
        )

        try {
          if (options.crypto === 'eapi') {
            zlib.unzip(body, function (err, buffer) {
              const _buffer = err ? body : buffer
              try {
                try {
                  answer.body = JSON.parse(encrypt.decrypt(_buffer).toString())
                  answer.status = answer.body.code || res.status
                } catch (e) {
                  answer.body = JSON.parse(_buffer.toString())
                  answer.status = res.status
                }
                // 800~803=二维码登录轮询状态，属于正常业务响应
                if ([800, 801, 802, 803].includes(answer.body.code)) answer.status = 200
              } catch (e) {
                answer.body = _buffer.toString()
                answer.status = res.status
              }
              answer.status = 100 < answer.status && answer.status < 600 ? answer.status : 400
              if (answer.status === 200) resolve(answer)
              else reject(answer)
            })
            return
          }

          answer.body = JSON.parse(body)
          answer.status = answer.body.code || res.status
          // 502=账号密码错误提示；800~803=二维码登录的轮询状态，都属于正常业务响应
          if ([502, 800, 801, 802, 803].includes(answer.body.code)) answer.status = 200
        } catch (e) {
          answer.body = body
          answer.status = res.status
        }

        answer.status = 100 < answer.status && answer.status < 600 ? answer.status : 400
        if (answer.status == 200) resolve(answer)
        else reject(answer)
      })
      .catch(err => {
        clearTimeout(timeout)
        answer.status = err.name === 'AbortError' ? 504 : 502
        answer.body = { code: answer.status, msg: 'Upstream request failed' }
        reject(answer)
      })
  })
}

module.exports = createRequest
