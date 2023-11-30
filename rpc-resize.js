const fs = require('fs')

const rpc = require('axon-rpc')
const axon = require('axon')
const req = axon.socket('req')

const client = new rpc.Client(req)
req.connect(4000, ip)

/**
 * @param {string} sourcePath
 * @param {string} destPath
 */
module.exports = async function (sourcePath, destPath, ip) {
  const s = process.hrtime.bigint()

  return await new Promise((res, rej) => {
    client.call('resize', fs.readFileSync(sourcePath), (err, ret) => {
      if (err || !ret) {
        rej(err)
        console.log(sourcePath, err)
        return
      }

      fs.writeFileSync(destPath, Buffer.from(ret.data))

      const cost = Number(process.hrtime.bigint() - s) / 1e9

      fs.rmSync(sourcePath)
      res(cost)
    })
  })
}
