const rpc = require('axon-rpc')
const axon = require('axon')
const rep = axon.socket('rep')

const chalk = require('chalk')

const Jimp = require('jimp')

const cachedJpegDecoder = Jimp.decoders['image/jpeg']
Jimp.decoders['image/jpeg'] = (data) => {
  const userOpts = { maxMemoryUsageInMB: 1024 }
  return cachedJpegDecoder(data, userOpts)
}

const server = new rpc.Server(rep)
rep.bind(4000, '0.0.0.0')

const SHARP_RATIO = 0.5

let index = 0

server.expose('resize', async (imgBuffer, fn) => {
  index++
  try {
    const buffer = Buffer.from(imgBuffer.data)
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

    fn(null, resultBuffer)
  } catch (error) {
    console.log(chalk.redBright(`[${index}] throw error`))
    fn(error)
  }
})

console.log('server online')
