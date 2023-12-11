/* eslint-disable no-magic-numbers */
/* eslint-disable no-empty */
const os = require('os')
const fs = require('fs')
const path = require('path')

const archiver = require('archiver')
const chalk = require('chalk')
const yauzl = require('yauzl')
const { v4: uuidV4 } = require('uuid')

const jschardet = require('jschardet')
const iconv = require('iconv-lite')
const { inspect } = require('util')
const { renameEx } = require('./fs-helper')

/**
 * @param {string} fileName
 */
function validateFileName(fileName) {
  if (fileName.indexOf('\\') !== -1) {
    return 'invalid characters in fileName: ' + fileName
  }
  if (/^[a-zA-Z]:/.test(fileName) || /^\//.test(fileName)) {
    return 'absolute path: ' + fileName
  }
  if (fileName.split('/').indexOf('..') !== -1) {
    return 'invalid relative path: ' + fileName
  }
  // all good
  return null
}

const openZipOpts = {
  autoClose: true,
  lazyEntries: true,
  decodeStrings: false,
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
           * @param {yauzl.Entry & { fileName: Buffer }} entry
           */
          (entry) => {
            // if (zipDebug) {
            // ;['binary', 'ascii', 'utf8', 'utf16le'].forEach((reverseEncoding) => {
            //   console.log(`filename reverse by ${reverseEncoding}`)
            //   // @ts-ignore
            //   const fileNameRaw = Buffer.from(entry.fileName, reverseEncoding)
            //   console.log(fileNameRaw.toString('hex'))
            //   console.log(`iconv.decode -> GBK:`, iconv.decode(fileNameRaw, 'GBK'))
            //   console.log(`iconv.decode -> gb2312:`, iconv.decode(fileNameRaw, 'gb2312'))
            //   console.log(`iconv.decode -> UTF-8:`, iconv.decode(fileNameRaw, 'UTF-8'))
            // })
            // console.log('entry.extraFields', entry.extraFields)
            // console.log(entry.extraFields?.[0]?.data?.toString('utf-8')?.normalize('NFC'))
            // console.log(iconv.decode(entry.extraFields?.[0]?.data, 'GBK'))
            // }
            const isUtf8 = (entry.generalPurposeBitFlag & 0x800) !== 0

            if (isUtf8) {
              // @ts-ignore
              entry.fileName = entry.fileName.toString('utf-8').normalize('NFC')
            } else {
              const jschardetRes = jschardet.detect(entry.fileName)

              const decoder = jschardetRes.confidence >= 0.8 ? jschardetRes.encoding : 'GB18030'
              const tryJschardet = iconv.decode(entry.fileName, jschardetRes.encoding)
              const tryUtf8 = iconv.decode(entry.fileName, 'UTF-8')
              // @ts-ignore
              entry.fileName = iconv.decode(entry.fileName, decoder).normalize('NFC')

              console.log(
                `(encoding) ${chalk.magentaBright('jschardet:')} ${chalk.greenBright(jschardetRes.encoding)}@${chalk.yellowBright(
                  jschardetRes.confidence.toFixed(3)
                )} ${chalk.yellowBright(
                  `yauzl.isUTF8?:${chalk.bold(String(isUtf8))}, use decoder: ${chalk.bold(decoder)}, content: ${chalk.bold(
                    entry.fileName
                  )} (content@${jschardetRes.encoding}:${chalk.gray(tryJschardet)}|content@utf8:${chalk.gray(tryUtf8)})`
                )}`
              )
            }

            // if (zipDebug) {
            //   console.log(`travelZipFile.readEntry.entry.fileName buffer is UTF-8?: ${isUtf8}, content: ${entry.fileName}`)
            // }

            const errorMsg = validateFileName(entry.fileName)
            if (errorMsg) {
              throw new Error(errorMsg)
            }

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
      wfs.on('error', (err) => {
        throw err
      })
      await new Promise((res) => {
        data.fileStream?.pipe(wfs)
        wfs.on('finish', res)
      })
    } else {
      await fs.promises.mkdir(path.resolve(unzipDir, data.entry.fileName))
    }
  }
}

/**
 * @param {string} zipFilePath
 * @param {{
 *    transformDir?: (path: string, stat: fs.Stats) => Promise<0 | 1 | 2>;
 *    transformFile?: (path: string, stat: fs.Stats) => Promise<void>
 * }} [transformer]
 * @param {string} [tempPath] 独占的临时目录，必须不存在或为空，函数每次执行独占一个
 */
async function rezipFile(zipFilePath, transformer, tempPath) {
  tempPath = tempPath || path.resolve(os.tmpdir(), uuidV4())

  // unzip
  await unzip(zipFilePath, tempPath)

  // transform
  let stack = [tempPath]

  while (stack.length) {
    const currentPath = stack.pop() || ''
    const subPathList = await fs.promises.readdir(currentPath)

    for (let i = 0; i < subPathList.length; i++) {
      const subPath = path.resolve(currentPath, subPathList[i])
      const subPathStat = await fs.promises.stat(subPath)

      if (subPathStat.isDirectory()) {
        // 0: not removed, 1: removed, 2: moved(need re-readdir)
        const removed = await transformer?.transformDir?.(subPath, subPathStat)
        if (removed === 0) {
          stack.push(subPath)
        } else if (removed === 2) {
          stack.push(currentPath)
          break
        }
      } else if (subPathStat.isFile() && !subPathStat.isSymbolicLink()) {
        await transformer?.transformFile?.(subPath, subPathStat)
      }
    }
  }

  // rezip
  const newZipPathTmp = path.parse(zipFilePath).base + 'tmp'
  await zipDirectoryWithThread(tempPath, newZipPathTmp)
  await fs.promises.rm(zipFilePath)
  await renameEx(newZipPathTmp, zipFilePath)
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
    // console.log(inspect(this, false, Infinity, true))
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
  getAllDirs() {
    let result = []

    if (this.isDirectory()) {
      if (this.name !== '/') result.push(this.name)

      this.children?.forEach((child) => {
        result = result.concat(child.getAllDirs())
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
   * 有一个唯一的根目录
   */
  hasOnlyRoot() {
    return this.children && this.children.length === 1 && this.children[0].isDirectory()
  }
  /**
   * zip 树是否具备 "良好" 性质，
   * "良好" 性质的树的根节点应该是一个目录（或没有根目录），
   * 根下的每个节点是目录，并且他们的子节点都是文件，
   * "良好" 性质中的 NoRoot 代表 zip 树没有根目录，
   * "良好" 性质中的 HasRoot 代表 zip 树有一个根目录
   * @returns {number} ZipTreeNode.WellFormedType
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

    // 每个子节点节点是目录，并且子子节点都是文件
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
  const fileNames = []

  for await (const { entry, type } of travelZipFile(filePath, { noStream: true })) {
    fileNames.push({ fileName: entry.fileName, type })
  }
  fileNames.reverse()
  while (fileNames.length > 0) {
    for (let i = fileNames.length - 1; i >= 0; i--) {
      if (!fileNames[i]) continue
      const { fileName: filename, type } = fileNames[i]

      const paths = filename.split('/').filter((p) => p !== '')

      let node = root

      const lastPath = paths.pop() || '?'
      try {
        paths.forEach((p) => {
          // @ts-ignore
          node = node.getChild(p)
        })
        // @ts-ignore
        node.children.push(new ZipTreeNode(lastPath, type === 'dir' ? [] : undefined))
        fileNames.splice(fileNames.findIndex((f) => f.fileName === filename))
      } catch {}
    }
  }
  return root
}

/**
 * true: zip dir count <= 1
 * false: zip dir count > 1
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
        // @ts-ignore
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
  rezipFile,
  travelZipFile,
  getZipTree,
  zipDirectory,
  zipDirectoryWithThread,
}
