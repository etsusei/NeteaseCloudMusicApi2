// 二维码登录 - 生成二维码内容（前端用 qrcode 库自行渲染图片）

module.exports = (query) => {
  const url = `https://music.163.com/login?codekey=${query.key || ''}`
  return Promise.resolve({
    status: 200,
    body: { code: 200, data: { qrurl: url } }
  })
}
