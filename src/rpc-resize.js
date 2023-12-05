const { promises: fs } = require('fs')

const rpc = require('axon-rpc')
const axon = require('axon')

const { callRpc } = require('./util')

const clients = new Map()

/**
 * @param {Buffer} sourceBuffer
 * @param {string} destPath
 */
module.exports = async function (sourceBuffer, destPath, ip, port) {
  const s = process.hrtime.bigint()

  return await new Promise((res, rej) => {
    const ipPort = `${ip}:${port}`
    if (!clients.has(ipPort)) {
      const reqSocket = axon.socket('req')
      const client = new rpc.Client(reqSocket)
      reqSocket.connect(port, ip)
      clients.set(ipPort, client)
    }

    callRpc(
      clients.get(ipPort),
      'resize',
      [sourceBuffer],
      (err, ret) => {
        if (err || !ret) {
          rej(err)
          console.log(sourceBuffer, err)
          return
        }

        fs.writeFile(destPath, Buffer.from(ret.data))
          .then(() => {
            const cost = Number(process.hrtime.bigint() - s) / 1e9
            res(cost)
          })
          .catch((err) => rej(err))
      },
      (sourceBuffer.byteLength / (100 * 1024)) * 1000 /** 100k/s */
    )
  })
}
