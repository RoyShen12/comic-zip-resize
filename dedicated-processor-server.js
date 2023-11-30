const os = require('os')

const rpc = require('axon-rpc')
const axon = require('axon')
const rep = axon.socket('rep')

const server = new rpc.Server(rep)
rep.bind(4000, '0.0.0.0')

const { DynamicPool } = require('node-worker-threads-pool')

const dynamicPool = new DynamicPool(os.cpus().length - 1)

const SHARP_RATIO = 0.5

let index = 0

server.expose('resize', async (imgBuffer, fn) => {
  try {
    index++
    const buffer = Buffer.from(imgBuffer.data)

    const transferredBuf = await dynamicPool.exec({
      task: async () => {
        const chalk = require('chalk')
        const Jimp = require('jimp')

        const cachedJpegDecoder = Jimp.decoders['image/jpeg']
        Jimp.decoders['image/jpeg'] = (data) => {
          const userOpts = { maxMemoryUsageInMB: 1024 }
          return cachedJpegDecoder(data, userOpts)
        }

        const inputSize = buffer.byteLength
        console.log(
          chalk.whiteBright(
            `[${index}] received resize.buf ${(inputSize / 1e3).toFixed(1)} KB`
          )
        )

        const jimpInst = await Jimp.read(buffer)

        const resultBuffer = await jimpInst
          .scale(SHARP_RATIO)
          .quality(80)
          .getBufferAsync(Jimp.MIME_JPEG)

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
      param: {},
    })

    fn(null, transferredBuf)
  } catch (error) {
    console.log(chalk.redBright(`[${index}] throw error`))
    fn(error)
  }
})

console.log('server online')
