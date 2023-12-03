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
    ip: '',
    port: 4000,
  },
  remoteServer: [
    // { ip: '192.168.50.59', threads: 20 }, // mac
    { ip: '192.168.50.136', threads: 24 }, // PC
    // { ip: '192.168.50.80', threads: 6 }, // nas 8-2
    // { ip: '192.168.50.98', threads: 2 }, // little nas 4-2
  ],
  // localThread: Math.max(1, os.cpus().length - 4),
  localThread: 0,
}
