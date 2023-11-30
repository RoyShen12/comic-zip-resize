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

let index = 0

// server.expose('resize', async (imgBuffer, fn) => {
//   index++
//   try {
//     console.log(`[${index}] resize.buf`, imgBuffer)

//     const jimpInst = await Jimp.read(imgBuffer)
//     console.log(`[${index}] jimpInst created`)
//     const resultBuffer = await jimpInst
//       .scale(SHARP_RATIO)
//       .quality(80)
//       .getBufferAsync(Jimp.MIME_JPEG)

//     console.log(`[${index}] resultBuffer resized finish`)

//     fn(null, resultBuffer)
//   } catch (error) {
//     fn(error)
//   }
// })

server.expose('resize', (imgBuffer, fn) => {
  index++
  try {
    console.log(`[${index}] resize.buf`, imgBuffer)

    console.log(`[${index}] resultBuffer resized finish`)

    fn(null, imgBuffer)
  } catch (error) {
    fn(error)
  }
})

console.log('server online')
