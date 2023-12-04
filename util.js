const path = require('path')
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

// expand jpeg memory
Jimp.decoders['image/jpeg'] = (data) =>
  JPEG.decode(data, { maxMemoryUsageInMB: JPEG_MAX_MEM })

const Retries = {}
const timeoutCountdown = new Map()
const alreadyTimeout = new Set()

/**
 *
 * @param {string} callId
 * @param {any} client
 * @param {string} name
 * @param {any[]} args
 * @param {(err?: Error | null, ...results: any[]) => void} callback
 * @param {number} timeout
 */
function callRpcInner(callId, client, name, args, callback, timeout) {
  if (process.env.RPC_LOG)
    console.log(
      `callRpcInner invoked, callId=${callId}, name=${name}, args=${JSON.stringify(
        args,
        null,
        2
      )}, timeout=${timeout}`
    )

  if (!timeoutCountdown.has(callId)) {
    timeoutCountdown.set(
      callId,
      setTimeout(() => {
        alreadyTimeout.add(callId)
        Retries[callId] = 0
        callback(
          new Error(
            `Timeout error to call remote server, call id ${callId}, timeout ${timeout}ms, server ${client?.sock?.server}`
          )
        )
      }, timeout)
    )
  }

  client.call(name, ...args, (err, ...results) => {
    if (alreadyTimeout.has(callId)) return

    if (process.env.RPC_LOG)
      console.log(`callRpcInner server response: `, err, results)
    clearTimeout(timeoutCountdown.get(callId))

    if (err) {
      if (!Retries[callId]) {
        Retries[callId] = 0
      }

      if (Retries[callId] < RPC_MAX_RETRY) {
        setTimeout(() => {
          Retries[callId]++
          callRpcInner(callId, client, name, args, callback, timeout)
        }, 100)
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
  /**
   * @param {number} defaultPort
   * @param {{method: string, port: number}[]} methods
   */
  constructor(defaultPort, methods) {
    const os = require('os')

    this.defaultPort = defaultPort
    this.methods = methods

    this.cpuNum = os.cpus().length
    this.platform = os.platform()
    this.freeMem = {
      value: os.freemem(),
      percent: os.freemem() / os.totalmem(),
    }
    this.network = Object.entries(os.networkInterfaces())
      .map((n) => [
        n[0],
        n?.[1]?.filter((ni) => !ni.internal && ni.family === 'IPv4'),
      ])
      .filter((n) => n[1] && n[1].length > 0)?.[0]?.[1]?.[0]
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
  callRpc(client, name, args, callback, timeout = RPC_TIMEOUT) {
    const callId = uuidV4()
    callRpcInner(callId, client, name, args, callback, timeout)
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
      }] to [${
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
    return pool.workers.some((w) => w.ready)
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
