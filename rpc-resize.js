const { promises: fs } = require('fs')
const { threadId } = require('worker_threads')

const rpc = require('axon-rpc')
const axon = require('axon')

const { callRpc } = require('./util')

const clients = new Map()
// remoteServer.map((srv) => {
//   const reqSocket = axon.socket('req')
//   const client = new rpc.Client(reqSocket)
//   reqSocket.connect(4000, srv.ip)
//   return [srv.ip, client]
// })

/**
 * @param {string} sourcePath
 * @param {string} destPath
 */
module.exports = async function (sourcePath, destPath, ip, port) {
  const s = process.hrtime.bigint()

  return await new Promise((res, rej) => {
    fs.readFile(sourcePath)
      .then((fContent) => {
        // console.log(
        //   `RpcClient [${String(threadId).padStart(2)}] try call ${ip}`
        // )
        const ipPort = `${ip}:${port}`
        if (!clients.has(ipPort)) {
          const reqSocket = axon.socket('req')
          const client = new rpc.Client(reqSocket)
          reqSocket.connect(port, ip)
          clients.set(ipPort, client)
        }

        callRpc(clients.get(ipPort), 'resize', [fContent], (err, ret) => {
          if (err || !ret) {
            rej(err)
            console.log(sourcePath, err)
            return
          }

          fs.writeFile(destPath, Buffer.from(ret.data))
            .then(() => {
              const cost = Number(process.hrtime.bigint() - s) / 1e9

              fs.rm(sourcePath)
                .then(() => {
                  res(cost)
                })
                .catch((err) => rej(err))
            })
            .catch((err) => rej(err))
        })
      })
      .catch((err) => rej(err))
  })
}
