// 手机登录

const crypto = require('crypto')

module.exports = async (query, request) => {
  query.cookie.os = 'pc'
  const data = {
    phone: query.phone,
    countrycode: query.countrycode || '86',
    rememberLogin: 'true'
  }

  if (query.captcha) {
    data.captcha = String(query.captcha)
  } else if (query.password) {
    data.password = crypto.createHash('md5').update(String(query.password)).digest('hex')
  } else {
    return Promise.reject({
      status: 400,
      body: { code: 400, msg: '请输入密码或短信验证码' }
    })
  }

  const result = await request(
    'POST', `https://music.163.com/weapi/login/cellphone`, data,
    {crypto: 'weapi', ua: 'pc', cookie: query.cookie, proxy: query.proxy}
  )

  return {
    ...result,
    body: {
      ...result.body,
      cookie: (result.cookie || []).join(';')
    }
  }
}
