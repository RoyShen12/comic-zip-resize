const os = require('os')
const path = require('path')

function isNodeLargerThan16() {
  return Number(process.versions.node.split('.')[0]) > 16
}

// jimp 单实例内存限制
const JPEG_MAX_MEM = 1536

module.exports = {
  // 临时目录
  TMP_PATH: os.platform() === 'darwin' ? path.resolve(os.homedir(), 'temp/image') : path.resolve(os.homedir(), 'bin/temp/image'),

  // 只处理尺寸大于此的图片
  SHARP_MIN_SIZE: 1 * 1024, // 单位 KByte
  // 图片缩小比例
  SHARP_RATIO: 0.5,
  SHARP_FILE_NAME_SUFFIX: '(LowQuality)',
  // 缩放最大尝试次数
  MAX_RETRY: 5,

  // rpc
  RPC_MAX_RETRY: 3,
  RPC_TIMEOUT: 15000,

  JPEG_MAX_MEM,

  // 注册中心地址，唯一需要配置的 ip 端口
  registryServer: {
    ip: '192.168.50.59',
    port: 4004,
  },

  localThread: isNodeLargerThan16()
    ? os.platform() === 'win32'
      ? 5
      : os.platform() === 'darwin'
      ? 4
      : 2
    : Math.max(1, os.cpus().length - 3),
  serverWorkerThread() {
    if (isNodeLargerThan16()) {
      // sharp
      if (os.cpus().length > 24) {
        return os.platform() === 'win32' ? 6 : 4
      } else if (os.cpus().length > 16) {
        return os.platform() === 'win32' ? 4 : 3
      } else if (os.cpus().length > 12) {
        return os.platform() === 'win32' ? 3 : 2
      } else {
        return os.platform() === 'win32' ? 2 : 1
      }
    } else {
      // jimp
      const memCapacity =
        Math.floor((os.freemem() / (JPEG_MAX_MEM * 1024 * 1024)) * (os.platform() === 'darwin' ? 1.5 : 1)) -
        (os.platform() === 'linux' ? 1 : 0)
      return Math.min(os.cpus().length - 1, memCapacity - 1)
    }
  },
  // localThread: 0,

  // 注册中心拉取配置间隔
  REMOTE_CONFIG_REFRESH: 1000,
  // 注册中心请求超时
  REMOTE_CONFIG_TIMEOUT: 300,
  // 注册超时
  REGISTRY_TIMEOUT: 600,
  // 心跳检查超时
  ALIVE_TIMEOUT: 600,
  // 心跳检查间隔
  ALIVE_INTERVAL: 2000,

  isNodeLargerThan16,
}