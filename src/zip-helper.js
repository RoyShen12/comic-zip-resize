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
 * @param {{afterOpen?: (zip: yauzl.ZipFile) => void, onCloseZip?: () => void}} [options]
 */
async function* travelZipFile(filePath, options) {
  const { afterOpen, onCloseZip } = options || {}
  /**
   * @type {yauzl.ZipFile}
   */
  const zipFile = await new Promise((res, rej) => {
    yauzl.open(filePath, openZipOpts, (err, zipFile) => {
      if (err) {
        rej(err)
      } else {
        res(zipFile)
      }
    })
  })

  afterOpen?.(zipFile)

  /**
   * @returns {Promise<[yauzl.Entry, 'dir' | 'file'] | undefined>}
   */
  const readEntry = () =>
    new Promise((resolve) => {
      zipFile
        .removeAllListeners('end')
        .once('entry', (entry) => {
          if (/\/$/.test(entry.fileName)) {
            resolve([entry, 'dir'])
          } else {
            resolve([entry, 'file'])
          }
        })
        .once('end', () => {
          resolve(undefined)
        })
        .readEntry()
    })

  zipFile.once('close', () => {
    onCloseZip?.()
  })

  while (true) {
    const entryRes = await readEntry()
    if (!entryRes) {
      break
    }
    const [entry, type] = entryRes
    /**
     * @type {{type: 'dir' | 'file', entry: yauzl.Entry, fileStream?: import('stream').Readable}}
     */
    const ret = { type, entry }
    if (type === 'file') {
      const s = process.hrtime.bigint()
      ret.fileStream = await readFileOverZip(zipFile, entry)
      console.log(
        `readFileOverZip cost ${(
          Number(process.hrtime.bigint() - s) / 1e6
        ).toFixed(1)}ms`
      )
    }
    yield ret
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
}
