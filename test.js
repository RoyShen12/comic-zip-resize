const os = require('os')
const fs = require('fs')
const path = require('path')

;(async () => {
  await fs.promises.rm(path.resolve(os.homedir(), 'Downloads/test2_unzip'), {
    recursive: true,
  })
  await fs.promises.mkdir(path.resolve(os.homedir(), 'Downloads/test2_unzip'))

  for await (const data of require('./src/zip-helper').travelZipFile(
    path.resolve(os.homedir(), 'Downloads/test.zip')
  )) {
    console.log('for await get data', data.type, data.entry.fileName)
    await new Promise((res) => setTimeout(res, Math.random() * 100))
    if (data.type === 'file') {
      const wfs = fs.createWriteStream(
        path.resolve(os.homedir(), 'Downloads/test2_unzip', data.entry.fileName)
      )
      await new Promise((res) => {
        data.fileStream?.pipe(wfs)
        wfs.on('finish', res)
      })
    } else {
      await fs.promises.mkdir(
        path.resolve(os.homedir(), 'Downloads/test2_unzip', data.entry.fileName)
      )
    }
    await new Promise((res) => setTimeout(res, Math.random() * 100))
  }
})()
