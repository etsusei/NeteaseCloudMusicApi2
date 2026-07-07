// 匿名设备身份：网易新版风控要求登录流程带可信的设备指纹和匿名账号 token(MUSIC_A)，
// 纯网页版 weapi 二维码登录已被下线(返回 8821 "请切换其他登录方式或升级新版本再试")
const crypto = require('crypto')
const request = require('./request')

const ID_XOR_KEY = '3go8&$8*3*3h0k(2)2'

// 进程内固定 deviceId（52 位大写 hex，与官方客户端格式一致），保持同一"设备"身份
const deviceId = Array.from({ length: 52 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('')

// 模拟 PC 客户端 3.1.17 的设备指纹（与社区维护版 api-enhanced 的 osMap.pc 一致）
const DEVICE_COOKIE = {
  os: 'pc',
  appver: '3.1.17.204416',
  osver: 'Microsoft-Windows-10-Professional-build-19045-64bit',
  channel: 'netease',
  deviceId
}

const encodeDeviceId = (id) => {
  let xored = ''
  for (let i = 0; i < id.length; i++) {
    xored += String.fromCharCode(id.charCodeAt(i) ^ ID_XOR_KEY.charCodeAt(i % ID_XOR_KEY.length))
  }
  return crypto.createHash('md5').update(xored, 'utf8').digest('base64')
}

let cached = null // { token, ts }
const TTL = 24 * 60 * 60 * 1000
// 失败也缓存一段时间：注册接口的老通道(eapi/weapi)已被网易关闭(返回 400)，
// 新通道要 xeapi 协议暂未移植。轮询每 2 秒一次，不能每次都白打一发注册请求。
const FAIL_TTL = 10 * 60 * 1000
let failedAt = 0

const getAnonymousToken = async () => {
  if (cached && Date.now() - cached.ts < TTL) return cached.token
  if (Date.now() - failedAt < FAIL_TTL) return ''

  try {
    const username = Buffer.from(`${deviceId} ${encodeDeviceId(deviceId)}`).toString('base64')
    const result = await request(
      'POST', `https://interface.music.163.com/eapi/register/anonimous`, { username },
      { crypto: 'eapi', url: '/api/register/anonimous', cookie: { ...DEVICE_COOKIE } }
    )
    const musicA = (result.cookie || [])
      .map(c => c.split(';')[0].trim())
      .find(p => p.startsWith('MUSIC_A='))
    const token = musicA ? musicA.slice('MUSIC_A='.length) : ''
    if (token) {
      cached = { token, ts: Date.now() }
      console.log('[Anonymous] 匿名 token 获取成功')
      return token
    }
  } catch (e) { /* 走下面的失败缓存 */ }

  failedAt = Date.now()
  console.log('[Anonymous] 匿名 token 不可用，二维码流程将不带 MUSIC_A')
  return ''
}

module.exports = { getAnonymousToken, DEVICE_COOKIE }
