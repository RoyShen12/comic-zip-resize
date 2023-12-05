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
   * @returns {Promise<[yauzl.Entry, 'dir' | 'file']>}
   */
  const readEntry = () =>
    new Promise((resolve) => {
      zipFile.once('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          resolve([entry, 'dir'])
        } else {
          resolve([entry, 'file'])
        }
      })
      zipFile.readEntry()
    })

  zipFile.once('end', () => {
    console.log('zipFile on end!')
    onCloseZip?.()
  })

  while (true) {
    const [entry, type] = await readEntry()
    /**
     * @type {{type: 'dir' | 'file', entry: yauzl.Entry, fileStream?: import('stream').Readable}}
     */
    const ret = { type, entry }
    if (type === 'file') {
      ret.fileStream = await readFileOverZip(zipFile, entry)
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
  readFileOverZip,
}
