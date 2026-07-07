// 歌曲链接 - v1 (eapi)
// level: standard / higher / exhigh / lossless / hires / jyeffect / sky / jymaster
// 相比老版 song/enhance/player/url，v1 按音质等级取源，能返回无损/Hi-Res 资源

module.exports = (query, request) => {
  query.cookie = query.cookie || {}
  query.cookie.os = 'android'
  query.cookie.appver = '8.10.05'
  const data = {
    ids: '[' + query.id + ']',
    level: query.level || 'exhigh',
    encodeType: 'flac'
  }
  if (data.level === 'sky') {
    data.immerseType = 'c51'
  }
  return request(
    'POST', `https://interface.music.163.com/eapi/song/enhance/player/url/v1`, data,
    {crypto: 'eapi', cookie: query.cookie, url: '/api/song/enhance/player/url/v1', proxy: query.proxy}
  )
}
