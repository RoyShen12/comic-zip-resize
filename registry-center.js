const os = require('os')

const rpc = require('axon-rpc')
const axon = require('axon')
const respSocket = axon.socket('rep')

const server = new rpc.Server(respSocket)
respSocket.bind(4000, '0.0.0.0')

/**
 * <method, server info>
 * @type {Map<string, ServerInfo>}
 */
const serverMap = new Map()

server.expose('registry', (info, fn) => {
  console.log('registry.info', info)
  fn(null, 'ok')
})

console.log('registry center online')
