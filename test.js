const os = require('os')
const fs = require('fs')
const path = require('path')

const h = os.homedir()
const p = path.resolve(h, 'Downloads/test2_unzip')

;(async () => {
  if (fs.existsSync(p))
    await fs.promises.rm(p, {
      recursive: true,
      force: true,
    })
  await fs.promises.mkdir(p)

  for await (const data of require('./src/zip-helper').travelZipFile(
    path.resolve(h, 'Downloads/test.zip'),
    {
      onCloseZip() {
        console.log('onCloseZip')
      },
    }
  )) {
    console.log('for await get data', data.type, data.entry.fileName)
    await new Promise((res) => setTimeout(res, Math.random() * 100))
    if (data.type === 'file') {
      const wfs = fs.createWriteStream(path.resolve(p, data.entry.fileName))
      await new Promise((res) => {
        data.fileStream?.pipe(wfs)
        wfs.on('finish', res)
      })
      console.log(data.type, data.entry.fileName, 'use finished')
    } else {
      await fs.promises.mkdir(path.resolve(p, data.entry.fileName))
    }
    await new Promise((res) => setTimeout(res, Math.random() * 100))
    console.log('for await single loop end')
  }
  console.log('for await end')
})().then(() => {
  console.log('async end')
})
