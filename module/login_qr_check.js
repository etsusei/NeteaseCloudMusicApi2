// 二维码登录 - 轮询扫码状态
// 800: 二维码过期  801: 等待扫码  802: 已扫码待确认  803: 登录成功（响应 cookie 字段含 MUSIC_U）

module.exports = (query, request) => {
  // 同 login_qr_key：不能带服务器 VIP 账号的登录态去轮询
  const cookie = { ...(query.cookie || {}) }
  delete cookie.MUSIC_U
  delete cookie.MUSIC_A
  delete cookie.__csrf

  const data = { key: query.key, type: 1 }
  return request(
    'POST', `https://music.163.com/weapi/login/qrcode/client/login`, data,
    { crypto: 'weapi', cookie, proxy: query.proxy }
  ).then((result) => ({
    status: 200,
    body: { ...result.body, cookie: (result.cookie || []).join(';') }
  }))
}
