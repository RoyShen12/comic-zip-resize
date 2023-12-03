// TODO: timeout and retry

const fs = require('fs')

const rpc = require('axon-rpc')
const axon = require('axon')

const { remoteServer } = require('./config')

const clients = new Map(
  remoteServer.map((srv) => {
    const reqSocket = axon.socket('req')
    const client = new rpc.Client(reqSocket)
    reqSocket.connect(4000, srv.ip)
    return [srv.ip, client]
  })
)

/**
 * @param {string} sourcePath
 * @param {string} destPath
 */
module.exports = async function (sourcePath, destPath, ip) {
  const s = process.hrtime.bigint()

  return await new Promise((res, rej) => {
    clients.get(ip).call('resize', fs.readFileSync(sourcePath), (err, ret) => {
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
