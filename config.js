const os = require('os')
const path = require('path')

module.exports = {
  TMP_PATH:
    os.platform() === 'darwin'
      ? path.resolve(os.homedir(), 'temp/image')
      : path.resolve(os.homedir(), 'bin/temp/image'),
  SHARP_RATIO: 0.5,
  MAX_RETRY: 5,
  RPC_MAX_RETRY: 3,
  RPC_TIMEOUT: 15000,
  JPEG_MAX_MEM: 1536,
  registryServer: {
    ip: '192.168.50.59',
    port: 4004,
  },
  // localThread: Math.max(1, os.cpus().length - 4),
  localThread: 1,
  REMOTE_CONFIG_REFRESH: 1000,
  REMOTE_CONFIG_TIMEOUT: 300,
  REGISTRY_TIMEOUT: 600,
  ALIVE_TIMEOUT: 600,
  ALIVE_INTERVAL: 2000,
}
