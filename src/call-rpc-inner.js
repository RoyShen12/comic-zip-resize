const { RPC_MAX_RETRY } = require('./config')

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
    console.log(`callRpcInner invoked, callId=${callId}, name=${name}, args=${JSON.stringify(args, null, 2)}, timeout=${timeout}`)

  if (!timeoutCountdown.has(callId)) {
    timeoutCountdown.set(
      callId,
      setTimeout(() => {
        alreadyTimeout.add(callId)
        Retries[callId] = 0
        callback(
          new Error(`Timeout error to call remote server, call id ${callId}, timeout ${timeout}ms, server ${client?.sock?.server}`)
        )
      }, timeout)
    )
  }

  client.call(name, ...args, (err, ...results) => {
    if (alreadyTimeout.has(callId)) return

    if (process.env.RPC_LOG) console.log(`callRpcInner server response: `, err, results)
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

module.exports = callRpcInner
