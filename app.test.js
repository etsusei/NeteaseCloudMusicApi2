const fs = require('fs')
const path = require('path')

let app
before(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-at-least-32-characters'
  app = require('./app.js')
  global.host = 'http://localhost:' + app.server.address().port
})
after((done) => {
  app.server.close(done)
})

fs.readdirSync(path.join(__dirname, 'test'))
  .forEach(file => {
    require(path.join(__dirname, 'test', file))
  })
