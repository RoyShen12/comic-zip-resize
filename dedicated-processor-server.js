const os = require('os')

const rpc = require('axon-rpc')
const axon = require('axon')
const respSocket = axon.socket('rep')

const chalk = require('chalk')

const server = new rpc.Server(respSocket)
respSocket.bind(4000, '0.0.0.0')

server.expose('threads', (fn) => {
  fn(os.cpus().length - 1)
})

const { DynamicPool } = require('node-worker-threads-pool')

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
            `[${index}] received resize.buf ${(inputSize / 1e3).toFixed(1)} KB`
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
