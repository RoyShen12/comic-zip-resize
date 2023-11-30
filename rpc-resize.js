/**
 * @param {string} sourcePath
 * @param {string} destPath
 */
module.exports = async function (sourcePath, destPath) {
  const fs = require('fs')

  const rpc = require('axon-rpc')
  const axon = require('axon')
  const req = axon.socket('req')

  const client = new rpc.Client(req)
  req.connect(4000, '192.168.50.59')

  return await new Promise((res, rej) => {
    client.call('resize', fs.readFileSync(sourcePath), function (err, ret) {
      if (err) rej(err)

      fs.writeFileSync(destPath, ret.data)
      res(ret.cost)
    })
  })
}
