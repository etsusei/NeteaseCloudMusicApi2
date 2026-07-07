// 二维码登录 - 轮询扫码状态（eapi 客户端协议，同 login_qr_key）
// 800: 二维码过期  801: 等待扫码  802: 已扫码待确认  803: 登录成功（响应 cookie 字段含 MUSIC_U）
// 其他码(如 8821 风控)也原样透传，让前端能展示真实原因

const { getAnonymousToken, DEVICE_COOKIE } = require('../util/anonymous')

module.exports = async (query, request) => {
  const cookie = { ...DEVICE_COOKIE }
  const anonToken = await getAnonymousToken().catch(() => '')
  if (anonToken) cookie.MUSIC_A = anonToken

  const normalize = (result) => {
    if (result && result.body && result.body.code !== undefined) {
      console.log(`[QR] check -> code=${result.body.code}${result.body.message ? ' ' + result.body.message : ''}`)
      return {
        status: 200,
        body: { ...result.body, cookie: (result.cookie || []).join(';') }
      }
    }
    return Promise.reject(result)
  }

  const data = { key: query.key, type: 3 }
  return request(
    'POST', `https://interface.music.163.com/eapi/login/qrcode/client/login`, data,
    { crypto: 'eapi', url: '/api/login/qrcode/client/login', cookie, proxy: query.proxy }
  ).then(normalize).catch(normalize)
}
