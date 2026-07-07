// 二维码登录 - 获取 unikey

module.exports = (query, request) => {
  // 登录流程必须用干净的 cookie：中间件可能已注入服务器 VIP 账号的登录态，
  // 带着它调登录接口会把扫码流程关联到 VIP 账号上
  const cookie = { ...(query.cookie || {}) }
  delete cookie.MUSIC_U
  delete cookie.MUSIC_A
  delete cookie.__csrf

  const data = { type: 1 }
  return request(
    'POST', `https://music.163.com/weapi/login/qrcode/unikey`, data,
    { crypto: 'weapi', cookie, proxy: query.proxy }
  ).then((result) => ({
    status: 200,
    body: { code: 200, data: result.body }
  }))
}
