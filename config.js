const os = require('os')

module.exports = {
  TMP_PATH: '/share/ZFS18_DATA/homes/roy/bin/temp/image',
  SHARP_RATIO: 0.5,
  MAX_RETRY: 5,
  JPEG_MAX_MEM: 1536,
  remoteServer: [
    { ip: '192.168.50.59', threads: 20 }, // mac
    { ip: '192.168.50.136', threads: 24 }, // PC
    { ip: '192.168.50.80', threads: 6 }, // nas 8-2
    { ip: '192.168.50.98', threads: 2 }, // little nas 4-2
  ],
  localThread: Math.max(1, os.cpus().length - 4),
}
