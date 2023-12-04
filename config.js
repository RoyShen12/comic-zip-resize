const os = require('os')
const path = require('path')

function isNodeLargerThan16() {
  return Number(process.versions.node.split('.')[0]) > 16
}

module.exports = {
  // 临时目录
  TMP_PATH:
    os.platform() === 'darwin'
      ? path.resolve(os.homedir(), 'temp/image')
      : path.resolve(os.homedir(), 'bin/temp/image'),

  // 图片缩小比例
  SHARP_RATIO: 0.5,
  // 缩放最大尝试次数
  MAX_RETRY: 5,

  // rpc
  RPC_MAX_RETRY: 3,
  RPC_TIMEOUT: 15000,

  // jimp 单实例内存限制
  JPEG_MAX_MEM: 1536,

  // 注册中心地址，唯一需要配置的 ip 端口
  registryServer: {
    ip: '192.168.50.59',
    port: 4004,
  },

  localThread: isNodeLargerThan16() ? 1 : Math.max(1, os.cpus().length - 3),
  serverWorkerThread: isNodeLargerThan16()
    ? os.cpus().length > 16
      ? 2
      : 1
    : os.cpus().length,
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
