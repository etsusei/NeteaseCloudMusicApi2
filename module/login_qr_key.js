// 二维码登录 - 获取 unikey
// 走 eapi 客户端协议 + PC 设备指纹 + 匿名 token：
// 旧的网页版 weapi 流程已被网易下线，扫码确认后会返回 8821 风控

const { getAnonymousToken, DEVICE_COOKIE } = require('../util/anonymous')

module.exports = async (query, request) => {
  const cookie = { ...DEVICE_COOKIE }
  const anonToken = await getAnonymousToken().catch((e) => {
    console.log('[QR] 匿名 token 获取失败:', e && (e.message || (e.body && e.body.message)) || String(e))
    return ''
  })
  if (anonToken) cookie.MUSIC_A = anonToken

  const data = { type: 3 }
  const result = await request(
    'POST', `https://interface.music.163.com/eapi/login/qrcode/unikey`, data,
    { crypto: 'eapi', url: '/api/login/qrcode/unikey', cookie, proxy: query.proxy }
  )
  return {
    status: 200,
    body: { code: 200, data: result.body }
  }
}
