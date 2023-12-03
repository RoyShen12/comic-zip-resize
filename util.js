const chalk = require('chalk')
const Jimp = require('jimp')
const JPEG = require('jpeg-js')
const { v4: uuidV4 } = require('uuid')

const {
  SHARP_RATIO,
  MAX_RETRY,
  JPEG_MAX_MEM,
  RPC_MAX_RETRY,
  RPC_TIMEOUT,
} = require('./config')

const Retries = {}

// expand jpeg memory
Jimp.decoders['image/jpeg'] = (data) =>
  JPEG.decode(data, { maxMemoryUsageInMB: JPEG_MAX_MEM })

function callRpcInner(callId, client, name, args, callback) {
  const timeoutId = setTimeout(() => {
    Retries[callId] = 0
    callback(new Error('Timeout error'))
  }, RPC_TIMEOUT)

  client.call(name, ...args, (err, ...results) => {
    clearTimeout(timeoutId)

    if (err) {
      if (!Retries[callId]) {
        Retries[callId] = 0
      }

      if (Retries[callId] < RPC_MAX_RETRY) {
        Retries[callId]++
        callRpcInner(callId, client, name, args, callback)
      } else {
        Retries[callId] = 0 // Reset retryCount
        callback(err)
      }
    } else {
      Retries[callId] = 0 // Reset retryCount
      callback(null, ...results)
    }
  })
}

class ServerInfo {
  constructor() {
    const os = require('os')

    this.cpuNum = os.cpus().length
    this.platform = os.platform()
    this.freeMem = {
      value: os.freemem(),
      percent: os.freemem() / os.totalmem(),
    }
    this.network = Object.entries(os.networkInterfaces())
      .map((n) => [
        n[0],
        n[1].filter((ni) => !ni.internal && ni.family === 'IPv4'),
      ])
      .filter((n) => n[1].length > 0)?.[0]?.[1]?.[0]
  }
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
  callRpc(client, name, args, callback) {
    const callId = uuidV4()
    callRpcInner(callId, client, name, args, callback)
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
