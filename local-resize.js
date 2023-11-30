const { imgScaleWithRetry } = require('./util')

/**
 * @param {string} sourcePath
 * @param {string} destPath
 */
module.exports = async function (sourcePath, destPath) {
  const s = process.hrtime.bigint()

  const Jimp = require('jimp')

  const cachedJpegDecoder = Jimp.decoders['image/jpeg']
  Jimp.decoders['image/jpeg'] = (data) => {
    const userOpts = { maxMemoryUsageInMB: 1024 }
    return cachedJpegDecoder(data, userOpts)
  }

  const jimpInst = await Jimp.read(sourcePath)

  await imgScaleWithRetry(jimpInst, destPath)

  const cost = Number(process.hrtime.bigint() - s) / 1e9
  return cost
}
