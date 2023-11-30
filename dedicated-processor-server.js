const rpc = require('axon-rpc')
const axon = require('axon')
const rep = axon.socket('rep')

const Jimp = require('jimp')

const cachedJpegDecoder = Jimp.decoders['image/jpeg']
Jimp.decoders['image/jpeg'] = (data) => {
  const userOpts = { maxMemoryUsageInMB: 1024 }
  return cachedJpegDecoder(data, userOpts)
}

const server = new rpc.Server(rep)
rep.bind(4000, '0.0.0.0')

const SHARP_RATIO = 0.5

server.expose('resize', async function (imgBuffer, fn) {
  try {
    const s = process.hrtime.bigint()
    console.log('resize.buf', imgBuffer)

    const jimpInst = await Jimp.read(imgBuffer)
    const resultBuffer = await jimpInst
      .scale(SHARP_RATIO)
      .quality(80)
      .getBufferAsync(Jimp.MIME_JPEG)

    const cost = Number(process.hrtime.bigint() - s) / 1e9
    fn(null, { data: resultBuffer, cost })
  } catch (error) {
    fn(error)
  }
})
