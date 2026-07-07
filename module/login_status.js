// 登录状态
// 用 weapi 的账号接口替代旧版"抓首页 HTML 正则出 GUser"的实现：
// 旧实现依赖页面结构，且未登录时只能拿到 301；这个接口未登录时 profile 为 null，前端好判断

module.exports = async (query, request) => {
  try {
    const result = await request(
      'POST', `https://music.163.com/api/nuser/account/get`, {},
      { crypto: 'weapi', cookie: query.cookie, proxy: query.proxy }
    )
    return { status: 200, body: { data: result.body } }
  } catch (e) {
    return { status: 200, body: { data: { code: 301, profile: null } } }
  }
}
