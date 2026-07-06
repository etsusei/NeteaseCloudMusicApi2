const get = ({ url, qs }, callback) => {
  const target = new URL(url)
  Object.keys(qs || {}).forEach(key => {
    target.searchParams.set(key, qs[key])
  })

  fetch(target)
    .then(async response => {
      const body = await response.text()
      callback(null, { statusCode: response.status }, body)
    })
    .catch(error => callback(error))
}

module.exports = { get }
