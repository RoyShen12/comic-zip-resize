const yauzl = require('yauzl')

const openZipOpts = {
  autoClose: true,
  lazyEntries: true,
  decodeStrings: true,
  validateEntrySizes: true,
  strictFileNames: false,
}

/**
 * @param {string} filePath
 * @param {(zip: yauzl.ZipFile) => void} [afterOpen]
 * @param {() => void} [onCloseZip]
 */
async function* travelZipFile(filePath, afterOpen, onCloseZip) {
  let resolve

  let entryPromise = new Promise((res) => {
    resolve = res
  })

  /**
   * @type {yauzl.ZipFile}
   */
  const zipFile = await new Promise((res, rej) => {
    yauzl.open(filePath, openZipOpts, (err, zipFile) => {
      if (err) {
        rej(err)
        return
      }
      res(zipFile)
    })
  })

  afterOpen?.(zipFile)

  zipFile.on('entry', async (entry) => {
    if (/\/$/.test(entry.fileName)) {
      resolve({ type: 'dir', entry })

      resolve = null
      setImmediate(() => {
        entryPromise = new Promise((res) => {
          resolve = res
        })
        console.log('dir setImmediate resolve', resolve)
      })
    } else {
      const fileStream = await readFileOverZip(zipFile, entry)
      resolve({ type: 'file', entry, fileStream })

      resolve = null
      setImmediate(() => {
        entryPromise = new Promise((res) => {
          resolve = res
        })
        console.log('file setImmediate resolve', resolve)
      })
    }
  })
  zipFile.on('close', () => {
    console.log('zipFile on close!')
    if (resolve) {
      resolve()
    }
    onCloseZip?.()
  })

  zipFile.readEntry()

  while (true) {
    console.log('while (true) entered')
    const result = await entryPromise
    console.log('while (true) typeof result', typeof result)
    if (!result) {
      break
    }

    console.log('resolve', resolve)
    // only read the next entry if the previous entry is processed
    if (resolve === null) {
      console.log('call zipFile.readEntry')
      zipFile.readEntry()
    }

    yield result
    console.log('yield entered')
  }
}

/**
 * @param {yauzl.ZipFile} zipFile
 * @param {yauzl.Entry} entry
 * @returns {Promise<import('stream').Readable>}
 */
function readFileOverZip(zipFile, entry) {
  return new Promise((res, rej) => {
    zipFile.openReadStream(entry, function (err, readStream) {
      if (err) {
        rej(err)
        return
      }
      res(readStream)
    })
  })
}

module.exports = {
  travelZipFile,
  readFileOverZip,
}
