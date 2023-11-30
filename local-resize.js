const { imgScaleWithRetry, imgReadWithRetry } = require('./util')

/**
 * @param {string} sourcePath
 * @param {string} destPath
 */
module.exports = async function (sourcePath, destPath) {
  const s = process.hrtime.bigint()

  const jimpInst = await imgReadWithRetry(sourcePath)

  await imgScaleWithRetry(jimpInst, destPath)

  const cost = Number(process.hrtime.bigint() - s) / 1e9
  return cost
}
