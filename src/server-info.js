module.exports = class ServerInfo {
  /**
   * @param {number} defaultPort
   * @param {{method: string, port: number}[]} methods
   * @param {number} threadsCapacity
   */
  constructor(defaultPort, methods, threadsCapacity) {
    const os = require('os')

    this.defaultPort = defaultPort
    this.methods = methods
    this.threadsCapacity = threadsCapacity

    this.cpuNum = os.cpus().length
    this.platform = os.platform()
    this.arch = os.arch()
    this.nodeVersion = process.versions.node
    this.freeMem = {
      value: os.freemem(),
      percent: os.freemem() / os.totalmem(),
    }
    this.network = Object.entries(os.networkInterfaces())
      .map((n) => [n[0], n?.[1]?.filter((ni) => !ni.internal && ni.family === 'IPv4')])
      .filter((n) => n[1] && n[1].length > 0)?.[0]?.[1]?.[0]
  }
}
