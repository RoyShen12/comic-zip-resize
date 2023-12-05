const rpc = require('axon-rpc')
const axon = require('axon')
const respSocket = axon.socket('rep')

const chalk = require('chalk')

const { DynamicPool } = require('node-worker-threads-pool')

const { registryServer, REGISTRY_TIMEOUT, serverWorkerThread } = require('./config')

const registrySocket = axon.socket('req')
const registryClient = new rpc.Client(registrySocket)
registrySocket.connect(registryServer.port, registryServer.ip)

const { callRpc, quit, ServerInfo } = require('./util')

const mainPort = 4000

const workerCount = serverWorkerThread()
console.log(`run with worker`, workerCount)

const thisServerInfo = new ServerInfo(
  mainPort,
  [
    {
      method: 'resize',
      port: mainPort,
    },
  ],
  workerCount
)

callRpc(
  registryClient,
  'registry',
  [thisServerInfo],
  (err, res) => {
    if (err || !res) {
      console.log(err)
      quit('registry failed!')
    }

    if (res !== 'ok') {
      quit(`registry error, server response ${res}`)
    }

    console.log('server online')
  },
  REGISTRY_TIMEOUT
)

const server = new rpc.Server(respSocket)
respSocket.bind(mainPort, '0.0.0.0')

server.expose('alive', (fn) => fn(null, 'still'))

const threadsPool = new DynamicPool(workerCount)

let index = 0

server.expose(
  'resize',
  /**
   * @param {{data: Uint8Array}} imgBuffer
   * @param {(err?: Error | null, buffer?: Buffer) => void} fn
   */
  async (imgBuffer, fn) => {
    try {
      index++

      const transferredBuf = await threadsPool.exec({
        task: async ({ index, imgBuffer }) => {
          const { threadId } = require('worker_threads')
          const chalk = require('chalk')

          // @ts-ignore
          const { imgScaleWithRetry } = require('./src/util')

          const buffer = Buffer.from(imgBuffer.data)

          const inputSize = buffer.byteLength
          console.log(
            chalk.whiteBright(
              `[T${String(threadId).padStart(2, ' ')}][${index}] received resize.buf ${(inputSize / 1e3).toFixed(1)} KB`
            )
          )

          const s = process.hrtime.bigint()
          const resultBuffer = await imgScaleWithRetry(buffer)
          const cost = (Number(process.hrtime.bigint() - s) / 1e9).toFixed(2)

          const resultSize = resultBuffer.byteLength
          const ratio = ((resultSize / inputSize) * 100).toFixed(1) + '%'

          console.log(
            chalk.greenBright(
              `[T${String(threadId).padStart(2, ' ')}][${index}] resized finish ${(resultSize / 1e3).toFixed(
                1
              )} KB (${ratio}) cost ${cost}s`
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
  }
)
