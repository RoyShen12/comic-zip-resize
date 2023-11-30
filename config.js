module.exports = {
  SHARP_RATIO: 0.5,
  MAX_RETRY: 5,
  JPEG_MAX_MEM: 1536,
  remoteServer: [
    { ip: '192.168.50.59', threads: 11 }, // mac
    { ip: '192.168.50.136', threads: 15 }, // PC
    { ip: '192.168.50.80', threads: 7 }, // nas
    { ip: '192.168.50.98', threads: 3 }, // little nas
  ],
}
