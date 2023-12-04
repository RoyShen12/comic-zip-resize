const path = require('path')
const chalk = require('chalk')
const { v4: uuidV4 } = require('uuid')
const Jimp = require('jimp')
const JPEG = require('jpeg-js')
let sharp
if (!isNodeLargerThan16()) {
  // expand jpeg memory
  Jimp.decoders['image/jpeg'] = (data) =>
    JPEG.decode(data, { maxMemoryUsageInMB: JPEG_MAX_MEM })
} else {
  sharp = require('sharp')
}

const {
  SHARP_RATIO,
  MAX_RETRY,
  JPEG_MAX_MEM,
  RPC_TIMEOUT,
} = require('./config')

const callRpcInner = require('./call-rpc-inner')
const ServerInfo = require('./server-info')

async function jimpReadImage(source, maxRetries = MAX_RETRY) {
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
}

function isNodeLargerThan16() {
  return Number(process.versions.node.split('.')[0]) > 16
}

module.exports = {
  ServerInfo,
  quit: function (msg = 'error & quit', code = 2) {
    console.log(chalk.redBright(msg))
    process.exit(code)
  },
  // enum
  ResizeMachine: {
    Local: 1,
    Remote: 2,
  },
  callRpc(client, name, args, callback, timeout = RPC_TIMEOUT) {
    const callId = uuidV4()
    callRpcInner(callId, client, name, args, callback, timeout)
  },
  /**
   * @param {string | Buffer} source
   * @param {string} [writeDestPath]
   * @returns {Promise<Buffer>}
   */
  async imgScaleWithRetry(source, writeDestPath, maxRetries = MAX_RETRY) {
    if (isNodeLargerThan16()) {
      const sharpInst = sharp(source)
      const meta = await sharpInst.metadata()
      if (!meta.width) {
        throw new Error('sharpInst.metadata.width not found')
      }
      const targetWidth = Math.round(meta.width * SHARP_RATIO)
      const resizedSharpInst = sharpInst
        .resize(targetWidth, null, {
          kernel: 'lanczos3',
        })
        .jpeg({
          quality: 80,
        })
      // @ts-ignore
      return writeDestPath
        ? await resizedSharpInst.toFile(writeDestPath)
        : await resizedSharpInst.toBuffer()
    } else {
      const jimpInst = await jimpReadImage(source)

      let retries = 0

      while (retries < maxRetries) {
        try {
          // @ts-ignore
          return writeDestPath
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
    }
  },
  logBeforeResize(
    thisIndex,
    fileIndex,
    filePath,
    entry,
    isLocal,
    selectedPool
  ) {
    console.log(
      `<${String(thisIndex).padStart(
        String(fileIndex).length,
        ' '
      )}> ${path.basename(filePath)}/${chalk.blueBright(
        entry.fileName
      )} dispatch to [${
        isLocal
          ? chalk.magentaBright('L ')
          : chalk.cyanBright('R' + selectedPool.remoteIndex)
      }]`
    )
  },
  logWhileChangeServer(
    thisIndex,
    fileIndex,
    filePath,
    entry,
    isLocal,
    selectedPool,
    oldIsLocal,
    oldSelectedPool,
    retried,
    error
  ) {
    console.error(error.message)
    console.log(
      `<${String(thisIndex).padStart(
        String(fileIndex).length,
        ' '
      )}> ${path.basename(filePath)}/${chalk.blueBright(
        entry.fileName
      )} ${chalk.redBright('Re')}dispatch from [${
        oldIsLocal
          ? chalk.magentaBright('L ')
          : chalk.cyanBright('R' + oldSelectedPool.remoteIndex)
      }] --> [${
        isLocal
          ? chalk.magentaBright('L ')
          : chalk.cyanBright('R' + selectedPool.remoteIndex)
      }] (retried ${chalk.redBright(retried)})`
    )
  },
  logAfterResize(
    thisIndex,
    fileIndex,
    isLocal,
    selectedPool,
    processedEntry,
    entryCount,
    filePath,
    entry,
    cost,
    processSpeed
  ) {
    console.log(
      `<${String(thisIndex).padStart(String(fileIndex).length, ' ')}> [${
        isLocal
          ? chalk.magentaBright('L ')
          : chalk.cyanBright('R' + selectedPool.remoteIndex)
      }] ${chalk.greenBright('resizing file')} (${String(
        processedEntry
      ).padStart(3, ' ')}/${String(entryCount).padStart(
        3,
        ' '
      )}) ${path.basename(filePath)}/${chalk.blueBright(
        entry.fileName
      )} cost: ${chalk.yellowBright(
        cost.toFixed(3)
      )} sec, speed: ${chalk.redBright(processSpeed.toFixed(1))} K/s`
    )
  },
  workerUtilization(pool) {
    return pool.workers.map(
      (w) =>
        `${(w.performance.eventLoopUtilization().utilization * 100).toFixed(
          2
        )}%`
    )
  },
  poolIsIdle(pool) {
    return pool && pool.workers && pool.workers.some((w) => w.ready)
  },
  async waitForPoolIdle(pool) {
    const waitStart = process.hrtime.bigint()
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (pool.workers.some((w) => w.ready)) {
          clearInterval(Number(checkInterval))
          resolve(Number(process.hrtime.bigint() - waitStart) / 1e9)
        }
      }, 100)
    })
  },
  async sleep(ms) {
    return new Promise((res) =>
      setTimeout(() => {
        res(undefined)
      }, ms)
    )
  },
}
