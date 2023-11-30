/**
 * @param {string} sourcePath
 * @param {string} destPath
 */
module.exports = async function (sourcePath, destPath) {
  const s = process.hrtime.bigint()

  const fs = require('fs')

  const rpc = require('axon-rpc')
  const axon = require('axon')
  const req = axon.socket('req')

  const client = new rpc.Client(req)
  req.connect(4000, '192.168.50.59')

  return await new Promise((res, rej) => {
    client.call('resize', fs.readFileSync(sourcePath), (err, ret) => {
      if (err) rej(err)

      fs.writeFileSync(destPath, Buffer.from(ret.data))

      const cost = Number(process.hrtime.bigint() - s) / 1e9

      res(cost)
    })
  })
}
