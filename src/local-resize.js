const { imgScaleWithRetry } = require('./util')
const fsModule = require('fs')
const fs = fsModule.promises

/**
 * @param {string} sourcePath
 * @param {string} destPath
 */
module.exports = async function (sourcePath, destPath) {
  const s = process.hrtime.bigint()

  await imgScaleWithRetry(sourcePath, destPath)

  await fs.rm(sourcePath)

  const cost = Number(process.hrtime.bigint() - s) / 1e9
  return cost
}
