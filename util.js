const chalk = require('chalk')
const Jimp = require('jimp')
const JPEG = require('jpeg-js')

const { SHARP_RATIO, MAX_RETRY, JPEG_MAX_MEM } = require('./config')

// expand jpeg memory
Jimp.decoders['image/jpeg'] = (data) =>
  JPEG.decode(data, { maxMemoryUsageInMB: JPEG_MAX_MEM })

module.exports = {
  quit: function (msg = 'error & quit', code = 2) {
    console.log(chalk.redBright(msg))
    process.exit(code)
  },
  ResizeMachine: {
    Local: 1,
    Remote: 2,
  },
  async imgReadWithRetry(source, maxRetries = MAX_RETRY) {
    let retries = 0

    while (retries < maxRetries) {
      try {
        return await Jimp.read(source)
      } catch (error) {
        console.error(error)
        retries++
        continue
      }
    }

    throw new Error('jimp.read max retries')
  },
  async imgScaleWithRetry(jimpInst, writeDestPath, maxRetries = MAX_RETRY) {
    let retries = 0

    while (retries < maxRetries) {
      try {
        return Boolean(writeDestPath)
          ? await jimpInst
              .scale(SHARP_RATIO)
              .quality(80)
              .writeAsync(writeDestPath)
          : await jimpInst
              .scale(SHARP_RATIO)
              .quality(80)
              .getBufferAsync(Jimp.MIME_JPEG)
      } catch (error) {
        console.error(error)
        retries++
        continue
      }
    }

    throw new Error('jimpInst.scale max retries')
  },
}
