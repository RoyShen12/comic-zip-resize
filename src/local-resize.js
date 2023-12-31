const { imgScaleWithRetry } = require('./util')
const { threadId } = require('worker_threads')

/**
 * @param {Buffer} sourceBuffer
 * @param {string} destPath
 */
module.exports = async function (sourceBuffer, destPath) {
  sourceBuffer = Buffer.from(sourceBuffer)
  const s = process.hrtime.bigint()

  await imgScaleWithRetry(sourceBuffer, destPath)

  const cost = Number(process.hrtime.bigint() - s) / 1e9
  return [cost, threadId]
}
