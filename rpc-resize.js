/**
 * @param {string} sourcePath
 * @param {string} destPath
 */
module.exports = async function (sourcePath, destPath, ip) {
  const s = process.hrtime.bigint()

  const fs = require('fs')

  const rpc = require('axon-rpc')
  const axon = require('axon')
  const req = axon.socket('req')

  const client = new rpc.Client(req)
  req.connect(4000, ip)

  return await new Promise((res, rej) => {
    const rpcStart = process.hrtime.bigint()
    client.call('resize', fs.readFileSync(sourcePath), (err, ret) => {
      if (err) rej(err)

      const rpcCost = Number(process.hrtime.bigint() - rpcStart) / 1e9
      console.log(`rpc cost ${rpcCost}s`)

      fs.writeFileSync(destPath, Buffer.from(ret.data))

      const cost = Number(process.hrtime.bigint() - s) / 1e9

      req.close()
      res(cost)
    })
  })
}
