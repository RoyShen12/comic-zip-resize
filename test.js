const os = require('os')
const fs = require('fs')
const path = require('path')

;(async () => {
  for await (const data of require('./src/zip-helper').travelZipFile(
    path.resolve(os.homedir(), 'Downloads/test2.zip')
  )) {
    console.log('for await get data', data.type, data.entry.fileName)
    const wfs = fs.createWriteStream(
      path.resolve(os.homedir(), 'Downloads', data.entry.fileName)
    )
    await new Promise((res) => {
      data.fileStream.pipe(wfs)
      wfs.on('finish', res)
    })
    await new Promise((res) => setTimeout(res, 200))
  }
})()
