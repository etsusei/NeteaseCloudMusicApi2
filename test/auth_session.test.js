const assert = require('assert')
const jwt = require('jsonwebtoken')

let app
let host
let ownsServer = false

const postRefresh = token => fetch(`${host}/api/auth/refresh`, {
  method: 'POST',
  headers: token ? { Authorization: `Bearer ${token}` } : {}
})

describe('自建账号会话续期', () => {
  before(done => {
    if (global.host) {
      host = global.host
      return done()
    }

    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-at-least-32-characters'
    process.env.HOST = '127.0.0.1'
    process.env.PORT = '0'
    app = require('../app')
    ownsServer = true

    const setHost = () => {
      host = `http://localhost:${app.server.address().port}`
      done()
    }
    if (app.server.listening) setHost()
    else app.server.once('listening', setHost)
  })

  after(done => {
    if (!ownsServer) return done()
    if (!app.server.listening) return done()
    app.server.close(done)
  })

  it('普通账号可换取新的 7 天 token', async () => {
    const { generateToken, JWT_SECRET } = require('../util/auth')
    const original = generateToken({ id: 1, username: 'listener', is_admin: false })
    const response = await postRefresh(original)
    const body = await response.json()

    assert.strictEqual(response.status, 200)
    assert.strictEqual(body.code, 200)
    assert(body.data.token)

    const decoded = jwt.verify(body.data.token, JWT_SECRET)
    assert.strictEqual(decoded.id, 1)
    assert.strictEqual(decoded.username, 'listener')
    assert.strictEqual(decoded.is_admin, false)
    assert(decoded.exp - decoded.iat >= (7 * 24 * 60 * 60) - 1)
  })

  it('过期 token 返回稳定的 TOKEN_EXPIRED', async () => {
    const { JWT_SECRET } = require('../util/auth')
    const token = jwt.sign(
      { id: 1, username: 'listener', is_admin: false },
      JWT_SECRET,
      { expiresIn: -1 }
    )
    const response = await postRefresh(token)
    const body = await response.json()

    assert.strictEqual(response.status, 401)
    assert.strictEqual(body.auth_code, 'TOKEN_EXPIRED')
  })

  it('伪造 token 返回稳定的 TOKEN_INVALID', async () => {
    const token = jwt.sign(
      { id: 1, username: 'listener', is_admin: false },
      'another-secret-with-at-least-32-characters',
      { expiresIn: '7d' }
    )
    const response = await postRefresh(token)
    const body = await response.json()

    assert.strictEqual(response.status, 401)
    assert.strictEqual(body.auth_code, 'TOKEN_INVALID')
  })

  it('缺少 token 返回稳定的 AUTH_REQUIRED', async () => {
    const response = await postRefresh()
    const body = await response.json()

    assert.strictEqual(response.status, 401)
    assert.strictEqual(body.auth_code, 'AUTH_REQUIRED')
  })

  it('管理员 token 不允许滑动续期', async () => {
    const { generateToken } = require('../util/auth')
    const token = generateToken({ id: 2, username: 'admin', is_admin: true })
    const response = await postRefresh(token)
    const body = await response.json()

    assert.strictEqual(response.status, 403)
    assert.strictEqual(body.auth_code, 'ADMIN_REFRESH_DISABLED')
  })
})
