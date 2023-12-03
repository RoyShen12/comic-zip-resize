const os = require('os')

const rpc = require('axon-rpc')
const axon = require('axon')
const respSocket = axon.socket('rep')

const chalk = require('chalk')

const { DynamicPool } = require('node-worker-threads-pool')

const { registryServer } = require('./config')
const registrySocket = axon.socket('req')
const registryClient = new rpc.Client(registrySocket)
registrySocket.connect(registryServer.port, registryServer.ip)
const { callRpc, quit, ServerInfo } = require('./util')
const thisServerInfo = new ServerInfo()
callRpc(registryClient, 'registry', [thisServerInfo], (err, res) => {
  if (err || !ret) {
    console.log(err)
    quit('registry failed!')
  }

  if (res !== 'ok') {
    quit(`registry error, server response ${res}`)
  }

  const server = new rpc.Server(respSocket)
  respSocket.bind(4000, '0.0.0.0')

  const threadsPool = new DynamicPool(os.cpus().length)

  let index = 0

  server.expose('resize', async (imgBuffer, fn) => {
    try {
      index++

      const transferredBuf = await threadsPool.exec({
        task: async ({ index, imgBuffer }) => {
          const chalk = require('chalk')

          const { imgScaleWithRetry, imgReadWithRetry } = require('./util')

          const buffer = Buffer.from(imgBuffer.data)

          const inputSize = buffer.byteLength
          console.log(
            chalk.whiteBright(
              `[${index}] received resize.buf ${(inputSize / 1e3).toFixed(
                1
              )} KB`
            )
          )

          const jimpInst = await imgReadWithRetry(buffer)

          const resultBuffer = await imgScaleWithRetry(jimpInst)

          const resultSize = resultBuffer.byteLength
          const ratio = ((resultSize / inputSize) * 100).toFixed(1) + '%'

          console.log(
            chalk.greenBright(
              `[${index}] resized finish ${(resultSize / 1e3).toFixed(
                1
              )} KB (${ratio})`
            )
          )

          return resultBuffer
        },
        param: {
          index,
          imgBuffer,
        },
      })

      fn(null, Buffer.from(transferredBuf))
    } catch (error) {
      console.log(chalk.redBright(`[${index}] throw error`))
      console.error(error)
      fn(error)
    }
  })

  console.log('server online')
})
