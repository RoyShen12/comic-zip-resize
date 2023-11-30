/**
 * @param {string} sourcePath
 * @param {string} destPath
 */
module.exports = async function (sourcePath, destPath, client) {
  const fs = require('fs')

  return await new Promise((res, rej) => {
    const s = process.hrtime.bigint()

    client.call('resize', fs.readFileSync(sourcePath), (err, ret) => {
      if (err) rej(err)

      console.log('rpc.client.ret', ret)
      console.log('arguments', ...arguments)

      fs.writeFileSync(destPath, ret)

      const cost = Number(process.hrtime.bigint() - s) / 1e9

      res(cost)
    })
  })
}
