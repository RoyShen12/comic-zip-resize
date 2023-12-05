const { DynamicPool } = require('node-worker-threads-pool')

const { localThread: localThreadsCount } = require('./config')
const { ResizeMachine, Solution, poolIsIdle, sleep } = require('./util')

const localDynamicPool =
  localThreadsCount > 0 ? new DynamicPool(localThreadsCount) : null
/**
 * @type {Map<string, DynamicPool>}
 */
const activeRemoteDynamicPools = new Map()
/**
 * @type {Map<string, DynamicPool>}
 */
const inactiveRemoteDynamicPools = new Map()

const getAllUsablePools = () =>
  localDynamicPool
    ? [localDynamicPool, ...activeRemoteDynamicPools.values()]
    : [...activeRemoteDynamicPools.values()]

/**
 * @param {{ip: string; port: number; threads: number}[]} remoteServer
 */
const createRandomPicker = (remoteServer) => {
  remoteServer.forEach((srv) => {
    const ipPort = `${srv.ip}:${srv.port}`
    if (!activeRemoteDynamicPools.has(ipPort)) {
      /**
       * @type {DynamicPool}
       */
      // @ts-ignore
      const pool = inactiveRemoteDynamicPools.has(ipPort)
        ? inactiveRemoteDynamicPools.get(ipPort)
        : new DynamicPool(srv.threads)
      inactiveRemoteDynamicPools.delete(ipPort)
      activeRemoteDynamicPools.set(ipPort, pool)
    }
  })

  activeRemoteDynamicPools.forEach((pool, ipPort) => {
    if (
      remoteServer.findIndex((srv) => {
        const remoteIpPort = `${srv.ip}:${srv.port}`
        return remoteIpPort === ipPort
      }) === -1
    ) {
      inactiveRemoteDynamicPools.set(ipPort, pool)
      activeRemoteDynamicPools.delete(ipPort)
    }
  })

  const threadWeight = [
    localThreadsCount,
    ...Array.from(activeRemoteDynamicPools.keys()).map((ipPort) => {
      const ip = ipPort.split(':')[0]
      return remoteServer.find((srv) => srv.ip === ip)?.threads
    }),
  ]
  const randomMachine = new Solution(threadWeight)

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
        pool: Array.from(activeRemoteDynamicPools.values())[remoteIndex],
        mark: ResizeMachine.Remote,
        remoteIndex,
        ip: remoteServer[remoteIndex].ip,
        port: remoteServer[remoteIndex].port,
      }
    }
  }
}

function closeAllPools() {
  localDynamicPool?.destroy()
  activeRemoteDynamicPools.forEach((p) => p.destroy())
  inactiveRemoteDynamicPools.forEach((p) => p.destroy())
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
      if (
        getAllUsablePools().length === 0 ||
        getAllUsablePools().every((pool) => !poolIsIdle(pool))
      ) {
        await sleep(100)
      }
    }
  }

  // @ts-ignore
  return [selectedPool, selectedPool.mark === ResizeMachine.Local]
}

module.exports = {
  getAllUsablePools,
  createRandomPicker,
  closeAllPools,
  choosePool,
}
