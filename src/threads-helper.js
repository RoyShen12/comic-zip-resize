const { DynamicPool } = require('node-worker-threads-pool')

const { localThread: localThreadsCount, zipThread } = require('./config')
const { ResizeMachine, poolIsIdle, sleep } = require('./util')

const zipPool = new DynamicPool(zipThread)
const localDynamicPool = localThreadsCount > 0 ? new DynamicPool(localThreadsCount) : null
/**
 * @type {Map<string, DynamicPool>}
 */
const activeRemotePoolMap = new Map()
/**
 * @type {Map<string, DynamicPool>}
 */
const inactiveRemotePoolMap = new Map()

const getAllUsablePools = () =>
  localDynamicPool ? [localDynamicPool, ...activeRemotePoolMap.values()] : [...activeRemotePoolMap.values()]

/**
 * @param {{ip: string; port: number; threads: number}[]} remoteServer
 */
const createRandomPicker = (remoteServer) => {
  remoteServer.forEach((srv) => {
    const ipPort = `${srv.ip}:${srv.port}`
    if (!activeRemotePoolMap.has(ipPort)) {
      /**
       * @type {DynamicPool}
       */
      // @ts-ignore
      const pool = inactiveRemotePoolMap.has(ipPort) ? inactiveRemotePoolMap.get(ipPort) : new DynamicPool(srv.threads)
      inactiveRemotePoolMap.delete(ipPort)
      activeRemotePoolMap.set(ipPort, pool)
    }
  })

  activeRemotePoolMap.forEach((pool, ipPort) => {
    if (
      remoteServer.findIndex((srv) => {
        const remoteIpPort = `${srv.ip}:${srv.port}`
        return remoteIpPort === ipPort
      }) === -1
    ) {
      inactiveRemotePoolMap.set(ipPort, pool)
      activeRemotePoolMap.delete(ipPort)
    }
  })

  const threadWeight = [
    localThreadsCount,
    ...Array.from(activeRemotePoolMap.keys()).map((ipPort) => {
      const ip = ipPort.split(':')[0]
      return remoteServer.find((srv) => srv.ip === ip)?.threads
    }),
  ]
  const randomMachine = new (require('./util').Solution)(threadWeight)

  /**
   * @returns {{pool: DynamicPool | null; mark: number; remoteIndex?: number; ip?: string; port?: number}}
   */
  return () => {
    const index = randomMachine.pickIndex()

    if (index === 0) {
      return { pool: localDynamicPool, mark: ResizeMachine.Local }
    } else {
      const remoteIndex = index - 1
      return {
        pool: Array.from(activeRemotePoolMap.values())[remoteIndex],
        mark: ResizeMachine.Remote,
        remoteIndex,
        ip: remoteServer[remoteIndex].ip,
        port: remoteServer[remoteIndex].port,
      }
    }
  }
}

/**
 * @param {() => {fn: ReturnType<createRandomPicker>}} dispatcherGetter
 * @param {{pool: DynamicPool}} [oldSelectedPool]
 * @returns {Promise<[{ pool: DynamicPool; mark: number; remoteIndex?: number; ip?: string; port?: number}, boolean]>}
 */
async function choosePool(dispatcherGetter, oldSelectedPool) {
  /**
   * @type {{ pool: DynamicPool | null; mark: number; remoteIndex?: number; ip?: string; port?: number} | undefined}
   */
  let selectedPool = undefined

  while (!selectedPool || !selectedPool.pool) {
    const dispatcher = dispatcherGetter().fn
    selectedPool = dispatcher()

    let flag = !poolIsIdle(selectedPool?.pool)
    if (oldSelectedPool && getAllUsablePools().length > 1) {
      flag = flag || selectedPool.pool === oldSelectedPool.pool
    }

    if (flag) {
      selectedPool = undefined
      if (getAllUsablePools().length === 0 || getAllUsablePools().every((pool) => !poolIsIdle(pool))) {
        // console.log('>'.repeat(20) + ' await thread idle')
        await sleep(40)
      }
    }
  }

  // @ts-ignore
  return [selectedPool, selectedPool.mark === ResizeMachine.Local]
}

function closeAllPools() {
  localDynamicPool?.destroy()
  activeRemotePoolMap.forEach((p) => p.destroy())
  inactiveRemotePoolMap.forEach((p) => p.destroy())
}

module.exports = {
  getZipPool() {
    return zipPool
  },
  getAllUsablePools,
  createRandomPicker,
  closeAllPools,
  choosePool,
}
