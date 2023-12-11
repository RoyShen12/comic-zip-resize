const fs = require('fs')
const path = require('path')

const archiver = require('archiver')
const chalk = require('chalk')
const yauzl = require('yauzl')

const chardet = require('chardet')
const iconv = require('iconv-lite')

const openZipOpts = {
  autoClose: true,
  lazyEntries: true,
  decodeStrings: true,
  validateEntrySizes: true,
  strictFileNames: false,
}

/**
 * @param {string} filePath
 * @param {{
 *   afterOpen?: (zip: yauzl.ZipFile) => void,
 *   onCloseZip?: () => void,
 *   noStream?: boolean,
 *   getForceCloseZip?: { get: null | (() => void) }
 * }} [options]
 */
async function* travelZipFile(filePath, options) {
  const { afterOpen, onCloseZip, noStream, getForceCloseZip } = options || {}
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

  if (getForceCloseZip) getForceCloseZip.get = () => zipFile.close()

  afterOpen?.(zipFile)

  /**
   * @returns {Promise<[yauzl.Entry, 'dir' | 'file'] | undefined>}
   */
  const readEntry = () =>
    new Promise((resolve) => {
      zipFile
        .removeAllListeners('end')
        .once(
          'entry',
          /**
           * @param {yauzl.Entry} entry
           */
          (entry) => {
            // const fileNameRaw = Buffer.from(entry.fileName, 'binary')
            // const r = chardet.detect(fileNameRaw)
            // console.log('chardet.detect', r)
            // console.log('iconv.decode', iconv.decode(fileNameRaw, 'windows-1252'))
            entry.fileName = entry.fileName.normalize('NFC')
            // console.log(`travelZipFile.readEntry.entry.fileName: ${entry.fileName}`)
            if (/\/$/.test(entry.fileName)) {
              resolve([entry, 'dir'])
            } else {
              resolve([entry, 'file'])
            }
          }
        )
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
    if (type === 'file' && !noStream) {
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

/**
 * @param {string} zipPath
 * @param {string} unzipDir
 */
async function unzip(zipPath, unzipDir) {
  await fs.promises.mkdir(unzipDir, { recursive: true })

  for await (const data of travelZipFile(zipPath)) {
    if (data.type === 'file') {
      if (!data.fileStream) throw new Error('unzip data[file] no fileStream')
      const wfs = fs.createWriteStream(path.resolve(unzipDir, data.entry.fileName))
      await new Promise((res) => {
        data.fileStream?.pipe(wfs)
        wfs.on('finish', res)
      })
    } else {
      await fs.promises.mkdir(path.resolve(unzipDir, data.entry.fileName))
    }
  }
}

class ZipTreeNode {
  /**
   * @readonly
   */
  static WellFormedType = {
    NotWellFormed: 0,
    HasRoot: 1,
    NoRoot: 2,
  }
  /**
   * @param {string} name
   * @param {ZipTreeNode[]} [children ]
   */
  constructor(name, children) {
    /**
     * @type {string}
     */
    this.name = name
    /**
     * @type {ZipTreeNode[] | null}
     */
    this.children = children || null
  }
  isDirectory() {
    return Array.isArray(this.children)
  }
  isFile() {
    return this.children === null
  }
  /**
   * @param {string} name
   */
  getChild(name) {
    return this.children?.find((c) => c.name === name)
  }
  /**
   * Get all file nodes
   * @returns {string[]}
   */
  getAllFiles() {
    let result = []

    if (this.isFile()) {
      result.push(this.name)
    } else if (this.isDirectory()) {
      this.children?.forEach((child) => {
        result = result.concat(child.getAllFiles())
      })
    }

    return result
  }
  print(indent = '', prefix = '') {
    console.log(`${indent}${prefix}${this.name}`)
    if (this.children && this.children.length > 0) {
      const length = this.children.length
      this.children.forEach((child, index) => {
        const isLastChild = index === length - 1
        const nextIndent = indent + (isLastChild ? '    ' : '│   ') // 使用 '    ' 替换最后的子节点，其余使用 '│   '
        const childPrefix = isLastChild ? '└── ' : '├── '
        child.print(nextIndent, childPrefix)
      })
    }
  }
  /**
   * @returns {number}
   */
  isWellFormed() {
    // 如果 root 节点下只有一个文件夹，递归判断这个文件夹是否 isWellFormed
    if (this.name === '/' && this.children?.length === 1 && this.children[0].isDirectory()) {
      return this.children[0].isWellFormed()
    }

    // "良好" 性质的树的根节点应该是一个目录
    if (!this.isDirectory()) {
      return ZipTreeNode.WellFormedType.NotWellFormed
    }

    // 检查根下的每个节点是目录，并且子节点都是文件
    for (const child of this.children || []) {
      // 每个节点必须是目录，并且每个子节点都是文件，并且不能为空
      if (!child.isDirectory() || child.children?.length === 0 || child.children?.some((child) => !child.isFile())) {
        return ZipTreeNode.WellFormedType.NotWellFormed
      }
    }

    return this.name === '/' ? ZipTreeNode.WellFormedType.NoRoot : ZipTreeNode.WellFormedType.HasRoot
  }
}

/**
 * @param {string} filePath
 */
async function getZipTree(filePath) {
  const root = new ZipTreeNode('/', [])

  for await (const data of travelZipFile(filePath, { noStream: true })) {
    const { fileName } = data.entry
    const paths = fileName.split('/').filter((p) => p !== '')

    let node = root

    const lastPath = paths.pop() || '?'
    paths.forEach((p) => {
      // @ts-ignore
      node = node.getChild(p)
    })
    node.children?.push(new ZipTreeNode(lastPath, data.type === 'dir' ? [] : undefined))
  }
  return root
}

/**
 * @param {string} filePath
 * @param {(isWellFormed: number) => Promise<void>} onWellFormed
 * @param {(files: string[]) => void} [fileNameCallback]
 */
async function checkZipFile(filePath, onWellFormed, fileNameCallback) {
  let zipDirCount = 0
  const files = []
  const closeWrapper = { get: () => {} }
  for await (const { type, entry } of travelZipFile(filePath, { noStream: true, getForceCloseZip: closeWrapper })) {
    if (type === 'dir') {
      zipDirCount++
      if (zipDirCount > 1) {
        const zipTree = await getZipTree(filePath)
        const isWellFormed = zipTree.isWellFormed()
        if (isWellFormed) {
          console.warn(
            chalk.yellowBright(
              `check zip file ${chalk.bold(filePath)} error: get zipDirCount > 1 in one file ${chalk.bold(
                `but is wellFormed ${chalk.bold(isWellFormed)}, will split it`
              )}`
            )
          )
          closeWrapper?.get?.()
          await onWellFormed(isWellFormed)
          return false
        } else {
          console.error(
            chalk.redBright(`check zip file ${chalk.bold(filePath)} error: get zipDirCount > 1 in one file and is not wellFormed`)
          )
          closeWrapper?.get?.()
          return false
        }
      }
    } else {
      files.push(entry.fileName)
    }
  }

  fileNameCallback?.(files)
  return true
}

/**
 * @param {string} dir
 * @param {import('stream').Writable} [outputStream]
 * @param {() => void} [onStartZipping]
 * @param {(pointer: number) => void | Promise<void>} [onWriteFinish]
 * @returns {Promise<string>}
 */
function zipDirectory(dir, outputStream, onStartZipping, onWriteFinish) {
  return new Promise((res, rej) => {
    // dir = path.resolve(dir)
    let zipPath = ''
    if (!outputStream) {
      zipPath = path.resolve(path.resolve(dir, '..'), `${path.basename(dir)}.zip`)
      outputStream = fs.createWriteStream(zipPath)
      console.log(`zipDirectory no outputStream, auto create as ${chalk.yellowBright(zipPath)}`)
    }
    const archive = archiver('zip', {
      zlib: {
        level: 0,
      },
    })

    outputStream.on('error', (err) => {
      console.log(chalk.redBright(`archive ${dir} on write stream error`))
      console.error(err)
      rej(err)
    })
    outputStream.on('close', async () => {
      await onWriteFinish?.(archive.pointer())
      res(zipPath)
    })

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.log(chalk.redBright(`archive ${dir} on warning: ENOENT`))
        console.error(err)
      } else {
        rej(err)
      }
    })
    archive.on('error', (err) => {
      console.log(chalk.redBright(`archive ${dir} on error`))
      console.error(err)
      rej(err)
    })

    archive.pipe(outputStream)

    onStartZipping?.()

    archive.directory(dir, false)

    archive.finalize()
  })
}

/**
 * @param {string} dir
 * @param {string} [outputPath]
 */
async function zipDirectoryWithThread(dir, outputPath) {
  if (!outputPath) {
    outputPath = path.resolve(path.resolve(dir, '..'), `${path.basename(dir)}.zip`)
    console.log(`zipDirectoryWithThread no outputPath, auto create as ${chalk.yellowBright(outputPath)}`)
  }

  return require('./threads-helper')
    .getZipPool()
    .exec({
      task: async ({ dir, outputPath }) => {
        const { threadId } = require('worker_threads')
        await require('./src/zip-helper').zipDirectory(dir, require('fs').createWriteStream(outputPath))
        return threadId
      },
      param: {
        dir,
        outputPath,
      },
    })
}

module.exports = {
  ZipTreeNode,
  checkZipFile,
  unzip,
  travelZipFile,
  getZipTree,
  zipDirectory,
  zipDirectoryWithThread,
}
