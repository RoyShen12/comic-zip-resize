const os = require('os')

const rpc = require('axon-rpc')
const axon = require('axon')
const respSocket = axon.socket('rep')

const server = new rpc.Server(respSocket)
respSocket.bind(4004, '0.0.0.0')

const { callRpc } = require('./util')

/**
 * @type {Map<string, Set<string>>}
 */
const methodMap = new Map() // method -> ip:port[]
/**
 * @type {Map<string, import('./util').ServerInfo>}
 */
const serverMap = new Map() // ip -> info
/**
 * @type {Map<string, boolean>}
 */
const statusMap = new Map() // ip -> is_ok

const checkServerAlive = (ip, port, onOK, onDie) => {
  const reqSocket = axon.socket('req')
  const client = new rpc.Client(reqSocket)
  reqSocket.connect(port, ip)

  callRpc(
    client,
    'alive',
    [],
    (err, res) => {
      if (err || !res) {
        onDie(err)
      } else {
        onOK()
      }
      reqSocket.close()
    },
    300
  )
}

server.expose(
  'registry',
  /**
   * @param {import('./util').ServerInfo} info
   * @param {(err?: Error | null, res?: string) => void} fn
   */
  (info, fn) => {
    // console.log('registry.info', info)
    const { defaultPort, methods, network } = info
    const ip = typeof network === 'string' ? network : network?.address

    if (!ip) {
      fn(new Error('registry error, source no ip'))
      return
    }

    checkServerAlive(
      ip,
      defaultPort,
      () => {
        serverMap.set(ip, info)

        methods.forEach((method) => {
          const ipPort = `${ip}:${method.port}`
          methodMap.has(method.method)
            ? methodMap.get(method.method)?.add(ipPort)
            : methodMap.set(method.method, new Set([ipPort]))
        })

        console.log(`server ${ip}:${defaultPort} registered`)
        statusMap.set(ip, true)
        fn(null, 'ok')
      },
      () => {
        fn(new Error('registry error, source no "alive" calling method'))
      }
    )
  }
)

server.expose(
  'getMethodConfig',
  /**
   * @param {string} method
   * @param {(err?: Error | null, res?: {ip: string, port: number,threads: number}[]) => void} fn
   */
  (method, fn) => {
    const result = methodMap.get(method)
    console.log('result', result, 'statusMap', statusMap)
    if (!result) {
      fn(new Error(`no such method`))
    } else {
      fn(
        null,
        Array.from(result)
          .map((server) => ({
            ip: server.split(':')[0],
            port: Number(server.split(':')[1]),
          }))
          .filter((server) => {
            return statusMap.get(server.ip)
          })
          .map((server) => {
            const info = serverMap.get(server.ip)
            const memCapacity = info
              ? Math.floor(
                  (info.freeMem.value / (1536 * 1024 * 1024)) *
                    (info.platform === 'darwin' ? 2 : 1)
                ) - (info.platform === 'linux' ? 1 : 0)
              : 2
            console.log(
              `memCapacity=${memCapacity},cpuNum=${info?.cpuNum || 2}`
            )
            return {
              ...server,
              threads: Math.min((info?.cpuNum || 2) - 1, memCapacity - 1),
            }
          })
      )
    }
  }
)

setInterval(() => {
  let allOk = true
  for (const server of serverMap) {
    const ip = server[0]
    const port = server[1].defaultPort
    checkServerAlive(
      ip,
      port,
      () => {
        statusMap.set(ip, true)
      },
      () => {
        allOk = false
        statusMap.set(ip, false)
        console.log(`server ${ip}:${port} down!`)
      }
    )
  }
  if (allOk) console.log(`routine check all ok`)
}, 5000)

console.log('registry center online')
