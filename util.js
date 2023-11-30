const chalk = require('chalk')
const Jimp = require('jimp')

module.exports = {
  quit: function (msg = 'error & quit', code = 2) {
    console.log(chalk.redBright(msg))
    process.exit(code)
  },
  ResizeMachine: {
    Local: 1,
    Remote: 2,
  },
  async imgReadWithRetry(source, maxRetries = 5) {
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
  async imgScaleWithRetry(jimpInst, writeDestPath, maxRetries = 5) {
    const SHARP_RATIO = 0.5
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
