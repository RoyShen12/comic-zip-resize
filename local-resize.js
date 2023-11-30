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

  const SHARP_RATIO = 0.5
  const jimpInst = await Jimp.read(sourcePath)

  await jimpInst.scale(SHARP_RATIO).quality(80).writeAsync(destPath)

  const cost = Number(process.hrtime.bigint() - s) / 1e9
  return cost
}
