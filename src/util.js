const chalk = require('chalk')
const { v4: uuidV4 } = require('uuid')

const { SHARP_RATIO, MAX_RETRY, JPEG_MAX_MEM, RPC_TIMEOUT, isNodeLargerThan16 } = require('./config')

const Jimp = require('jimp')
const JPEG = require('jpeg-js')
let sharp
if (!isNodeLargerThan16()) {
  // expand jpeg memory
  Jimp.decoders['image/jpeg'] = (data) => JPEG.decode(data, { maxMemoryUsageInMB: JPEG_MAX_MEM })
} else {
  sharp = require('sharp')
}

const callRpcInner = require('./call-rpc-inner')

const constants = require('./constants')
const logHelpers = require('./log-helper')
const zipHelpers = require('./zip-helper')

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

module.exports = {
  Solution: require('./random-with-weight'),
  ServerInfo: require('./server-info'),
  quit: function (msg = 'error & quit', code = 2) {
    console.log(chalk.redBright(msg))
    process.exit(code)
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
      let retries = 0

      while (retries < maxRetries) {
        try {
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
          return writeDestPath ? await resizedSharpInst.toFile(writeDestPath) : await resizedSharpInst.toBuffer()
        } catch (error) {
          console.error(error)
          retries++
          continue
        }
      }

      throw new Error('sharp.resize max retries')
    } else {
      const jimpInst = await jimpReadImage(source)

      let retries = 0

      while (retries < maxRetries) {
        try {
          // @ts-ignore
          return writeDestPath
            ? await jimpInst.scale(SHARP_RATIO).quality(80).writeAsync(writeDestPath)
            : await jimpInst.scale(SHARP_RATIO).quality(80).getBufferAsync(Jimp.MIME_JPEG)
        } catch (error) {
          console.error(error)
          retries++
          continue
        }
      }

      throw new Error('jimpInst.scale max retries')
    }
  },
  workerUtilization(pool) {
    return pool.workers.map((w) => `${(w.performance.eventLoopUtilization().utilization * 100).toFixed(2)}%`)
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
  /**
   * @param {import('fs').WriteStream} wfs
   * @returns {Promise<void>}
   */
  async writeFsClosed(wfs) {
    return new Promise((res, rej) => {
      wfs.on('finish', () => {
        wfs.close((err) => {
          if (err) {
            rej(err)
          } else {
            res()
          }
        })
      })
    })
  },
  /**
   * @param {number} ms
   */
  async sleep(ms) {
    return new Promise((res) =>
      setTimeout(() => {
        res(undefined)
      }, ms)
    )
  },
  ...constants,
  ...logHelpers,
  ...zipHelpers,
}