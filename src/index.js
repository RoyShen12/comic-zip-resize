const fsModule = require('fs')
const path = require('path')

const { createWriteStream } = fsModule
const fs = fsModule.promises

const chalk = require('chalk')
const { v4: uuidV4 } = require('uuid')
const stringSimilarity = require('string-similarity')

const {
  quit,
  callRpc,
  logBeforeResize,
  logAfterResize,
  logWhileChangeServer,
  logAfterSkipped,
  logStartFileProcess,
  travelZipFile,
  readStreamToBuffer,
  zipDirectory,
  unzip,
  ZipTreeNode,
  moveUpFilesAndDeleteEmptyFolders,
  checkZipFile,
  removeAllFiles,
  renameEx,
  pathToHighlight,
  hasDuplicates,
  formatMap,
} = require('./util')
const { createRandomPicker, closeAllPools, choosePool } = require('./threads-helper')

const workingDir = process.argv[2]
const noFixZip = process.argv.includes('--no-fix-zip')
const forceFixZip = process.argv.includes('--force-fix-zip')
const noResizeMode = process.argv.includes('--no-resize')
const oneShotCheck = process.argv.includes('--oneshot')
const oneShotDryRun = oneShotCheck && process.argv.includes('--dry-run')
const silenceMode = process.argv.includes('--silence')

if (!workingDir) {
  quit('working dir is empty')
}

const configRpc = require('axon-rpc')
const axon = require('axon')

const {
  TMP_PATH,
  registryServer,
  REMOTE_CONFIG_REFRESH,
  REMOTE_CONFIG_TIMEOUT,
  SHARP_MIN_SIZE,
  SHARP_FILE_NAME_SUFFIX,
  oneShotSuffix,
  oneShotFileNameAfterProcessor,
} = require('./config')
const { timeProbe } = require('./debug')

// request registry server for remote server information
const configServerSocket = axon.socket('req')
const configServerClient = new configRpc.Client(configServerSocket)
configServerSocket.connect(registryServer.port, registryServer.ip)

let getConfigTimer
let fileIndex = 0

const dryRunOneShotFiles = []

callRpc(
  configServerClient,
  'getMethodConfig',
  ['resize'],
  /**
   * @param {Error | null} err
   * @param {{ip: string, port: number, threads: number}[]} remoteServer
   */
  (err, remoteServer) => {
    let localMode = false

    if (noResizeMode || oneShotCheck) {
      localMode = true
    }

    if (!localMode && (err || !remoteServer)) {
      console.log(err)
      console.log('get "getMethodConfig" failed! run in local mode')
      localMode = true
    }

    remoteServer = []

    const randomDispatcher = { fn: createRandomPicker(remoteServer) }
    if (!localMode) {
      getConfigTimer = setInterval(() => {
        callRpc(
          configServerClient,
          'getMethodConfig',
          ['resize'],
          (err, remoteServer) => {
            if (!err && remoteServer) {
              randomDispatcher.fn = createRandomPicker(remoteServer)
            }
          },
          REMOTE_CONFIG_TIMEOUT
        )
      }, REMOTE_CONFIG_REFRESH)
    }

    async function scanDirectory(pathParam) {
      if (!silenceMode) console.log(`scan dir: ${chalk.blueBright(pathParam)}`)
      const subFiles = (await fs.readdir(pathParam)).filter((subFile) => subFile !== '.DS_Store')

      for (const subFile of subFiles) {
        const subPath = path.resolve(pathParam, subFile)

        const subPathStat = await fs.stat(subPath)

        if (subPathStat.isDirectory()) {
          await scanDirectory(subPath)
        } else if (subPathStat.isFile() && !subPathStat.isSymbolicLink() && subFile.endsWith('.zip')) {
          // one shot check
          // https://komga.org/docs/guides/oneshots/
          if (oneShotCheck) {
            const oneshotPath = path.resolve(pathParam, '..', '_oneshots')

            const pathParamName = path.parse(pathParam).base
            const subFileName = path.parse(subFile).name
            const pathNameAndFileNameSimilarity = stringSimilarity.compareTwoStrings(pathParamName, subFileName)

            const oneShotFileName = oneShotFileNameAfterProcessor(pathParamName) + '.zip'
            const subFileNewPath = path.resolve(oneshotPath, oneShotFileName)

            if (subFiles.length === 1 && !fsModule.existsSync(subFileNewPath)) {
              if (
                pathNameAndFileNameSimilarity === 1 ||
                // oneShotSuffix.some((suf) => pathParamName + suf === subFileName)
                oneShotSuffix.some((suf) => stringSimilarity.compareTwoStrings(pathParamName + suf, subFileName) === 1)
              ) {
                // library level:
                // series level:          pathParam
                // book level:    *.zip   subPath

                console.log(`${chalk.yellowBright('oneShotCheck get target')} ${pathToHighlight(subPath)}`)

                // move subPath -> series/_oneshots && rm -r pathParam (should be empty)

                if (!fsModule.existsSync(oneshotPath)) await fs.mkdir(oneshotPath)

                if (oneShotDryRun) {
                  console.log(
                    `dry run fs: fs.rename(\n${chalk.redBright(pathToHighlight(subPath))},\n${chalk.greenBright(
                      pathToHighlight(subFileNewPath)
                    )}\n)`
                  )
                  console.log(`dry run fs: fs.rm(${chalk.redBright(pathToHighlight(pathParam))}, { recursive: true })`)
                  dryRunOneShotFiles.push(oneShotFileName)
                  dryRunOneShotFiles.sort()
                  console.log('dryRunOneShotFiles has dup:', hasDuplicates(dryRunOneShotFiles))
                } else {
                  await fs.rename(subPath, subFileNewPath)
                  await fs.rm(pathParam, { recursive: true })
                }
                console.log('\n')
                return
              } else {
                console.log(`pathParamName: ${pathParamName}`)
                console.log(`subFileName: ${subFileName}`)
                console.log(`Similarity`, pathNameAndFileNameSimilarity)
                console.log(
                  oneShotSuffix
                    .map(
                      (suf) =>
                        `Similarity[${suf}]: ${chalk.yellowBright(stringSimilarity.compareTwoStrings(pathParamName + suf, subFileName))}`
                    )
                    .join('\n')
                )
                console.log('\n')
              }
            }
          } else {
            try {
              await scanZipFile(subPath)
            } catch (error) {
              console.log(`error on file ${subPath}`)
              console.log(error)
            }
          }
        }
      }

      // await Promise.all(subFiles.map(async (subFile) => {}))
    }

    /**
     * make SHARP_RATIO x zip with $SHARP_FILE_NAME_SUFFIX file name
     * @param {string} filePath
     */
    async function scanZipFile(filePath) {
      if (!silenceMode) console.log(`scan file: ${chalk.magentaBright(filePath)}`)
      const fileBaseName = path.basename(filePath)
      const filePathParsed = path.parse(filePath)
      const fileLowQualityPath = `${filePathParsed.dir}/${filePathParsed.name} ${SHARP_FILE_NAME_SUFFIX}${filePathParsed.ext}`

      if (
        fileBaseName.includes(SHARP_FILE_NAME_SUFFIX) ||
        !(await fs.readdir(filePathParsed.dir))
          .filter((fp) => fp !== fileBaseName)
          .every((fp) => path.parse(fp).name !== path.parse(fileLowQualityPath).name)
      )
        return

      fileIndex++
      const thisIndex = fileIndex
      const id = uuidV4()
      const tempPath = path.resolve(TMP_PATH, id)

      // check and fix zip structure
      if (
        !(await checkZipFile(
          filePath,
          async (isWellFormed) => {
            if (noFixZip) return
            if (!fsModule.existsSync(tempPath)) await fs.mkdir(tempPath, { recursive: true })

            const tempUnzipPath = path.resolve(tempPath, 'unzip_temp')
            await unzip(filePath, tempUnzipPath)
            if (isWellFormed === ZipTreeNode.WellFormedType.HasRoot) {
              await moveUpFilesAndDeleteEmptyFolders(tempUnzipPath)
            } else {
              // 删除遍历中已经 resize 了的输出文件
              await removeAllFiles(tempPath)
            }
            // unzip_temp |- a
            //            |- b
            const subDirs = (await fs.readdir(tempUnzipPath)).filter((f) => f !== '.DS_Store')
            const newZipFilePaths = await Promise.all(
              subDirs.map(async (subDir) => {
                const subPath = path.resolve(tempUnzipPath, subDir)
                const outPath = await zipDirectory(subPath)
                // clean unzipped files
                await fs.rm(subPath, { recursive: true, force: true })
                // move to origin path
                const outPathParsed = path.parse(outPath)
                const originFileName = filePathParsed.name
                const insert = originFileName.normalize('NFC') === outPathParsed.name.normalize('NFC') ? '[rezip]' : ''
                const newFilePath = path.resolve(filePath, '..', `${outPathParsed.name}${insert}${outPathParsed.ext}`)
                await renameEx(outPath, newFilePath)
                return newFilePath
              })
            )
            await fs.rm(filePath)
            if (!noResizeMode) {
              for (const newZipFilePath of newZipFilePaths) {
                await scanZipFile(newZipFilePath)
              }
            }
          },
          (files) => {
            if (!silenceMode) {
              console.log(
                `zip inside file ext map`,
                formatMap(
                  files
                    .map((f) => path.parse(f).ext)
                    .reduce((p, c) => {
                      if (!p.has(c)) p.set(c, 1)
                      else p.set(c, p.get(c) + 1)
                      return p
                    }, new Map())
                )
              )
            }
          }
        ))
      ) {
        return
      }

      if (noResizeMode) return

      if (!fsModule.existsSync(tempPath)) await fs.mkdir(tempPath, { recursive: true })

      logStartFileProcess(filePath, tempPath)

      /**
       * zip 文件总的 item 数，包含目录和文件
       */
      let entryCount
      /**
       * 目录数
       */
      let zipDirCount = 0
      /**
       * 垃圾文件数
       */
      let trashFileCount = 0
      /**
       * 已处理的文件数，包含跳过的小尺寸图
       */
      let processedEntries = 0
      /**
       * 已跳过的小尺寸图
       */
      let skippedEntries = 0
      const getActualFileCount = () => entryCount - zipDirCount - trashFileCount

      const fileStart = process.hrtime.bigint()

      /**
       * @type {Promise<void>[]}
       */
      const allFileReady = []

      for await (const { type, entry, fileStream } of travelZipFile(filePath, {
        afterOpen(zipFile) {
          if (!zipFile.entryCount) {
            throw new Error(`error while read zipFile.entryCount ${zipFile.entryCount}`)
          }
          entryCount = zipFile.entryCount
        },
        onCloseZip() {
          console.log(
            `<${String(thisIndex).padStart(String(fileIndex).length, ' ')}> ${path.basename(filePath)} ${chalk.greenBright(
              'read finish'
            )}`
          )
        },
      })) {
        if (type === 'dir') {
          console.log(`${chalk.yellowBright('entry(dir)')}: ${chalk.gray(entry.fileName)}`)
          zipDirCount++
        } else {
          const { name: entryName, ext: entryExtName, base: entryBaseName } = path.parse(entry.fileName)

          if (entryExtName === '.db' || entryExtName === '.txt' || entryName.startsWith('.')) {
            // just skip it
            trashFileCount++
            continue
          }

          if (!fileStream) {
            throw new Error(`cannot get ${entry.fileName}'s fileStream`)
          }

          // 加入并行队列
          allFileReady.push(
            (async () => {
              /**
               * @type {Buffer}
               */
              const entryBuffer = await readStreamToBuffer(fileStream)
              const sourceSize = entryBuffer.byteLength
              if (sourceSize <= SHARP_MIN_SIZE * 1024) {
                // skip resize
                await fs.writeFile(path.resolve(tempPath, entryBaseName), entryBuffer)
                processedEntries++
                skippedEntries++
                logAfterSkipped(thisIndex, fileIndex, processedEntries, getActualFileCount(), filePath, entry)
              } else {
                const resizedPath = path.resolve(tempPath, `${entryName}-lowQ${entryExtName}`)
                let cost = undefined
                let threadId = undefined
                // thread
                let [selectedPool, isLocal] = await choosePool(() => randomDispatcher)

                let retried = 0
                while (cost === undefined) {
                  logBeforeResize(thisIndex, fileIndex, filePath, entry, isLocal, selectedPool)

                  try {
                    // eslint-disable-next-line no-extra-semi
                    ;[cost, threadId] = await selectedPool.pool
                      .createExecutor(
                        isLocal
                          ? // @ts-ignore
                            ({ sourceBuffer, destPath }) => require('./src/local-resize')(sourceBuffer, destPath)
                          : ({ sourceBuffer, destPath, ip, port }) =>
                              // @ts-ignore
                              require('./src/rpc-resize')(sourceBuffer, destPath, ip, port)
                      )
                      .setTransferList([entryBuffer.buffer])
                      .exec({
                        sourceBuffer: entryBuffer,
                        destPath: resizedPath,
                        ip: selectedPool.ip,
                        port: selectedPool.port,
                      })
                  } catch (error) {
                    retried++
                    const oldPool = { ...selectedPool }
                    const oldIsLocal = isLocal

                    ;[selectedPool, isLocal] = await choosePool(() => randomDispatcher, oldPool)
                    logWhileChangeServer(
                      thisIndex,
                      fileIndex,
                      filePath,
                      entry,
                      isLocal,
                      selectedPool,
                      oldIsLocal,
                      oldPool,
                      retried,
                      error
                    )
                  }
                }

                processedEntries++

                logAfterResize(
                  thisIndex,
                  fileIndex,
                  isLocal,
                  selectedPool,
                  processedEntries,
                  skippedEntries,
                  fileStart,
                  getActualFileCount(),
                  filePath,
                  entry,
                  cost,
                  sourceSize / cost / 1024,
                  threadId
                )
              }
            })()
          )
        } // ========== end of type is 'file'
      } // ========== end of for await loop

      await Promise.all(allFileReady)

      if (processedEntries < getActualFileCount()) {
        throw new Error(`processedFile ${processedEntries} < actualFile ${getActualFileCount()}`)
      }

      const hasNoChange = skippedEntries === getActualFileCount()

      console.log(chalk.greenBright(`${path.basename(filePath)} unzip and resize finished`))

      if (hasNoChange) {
        console.log(chalk.yellowBright(`${path.basename(filePath)} no change and skip zipping`))
      } else {
        // promise of zip resized files
        await zipDirectory(
          tempPath,
          createWriteStream(fileLowQualityPath),
          () => console.log(`${chalk.cyanBright(path.basename(filePath))} ${chalk.greenBright('start zipping')}`),
          (pointer) =>
            console.log(
              `${chalk.greenBright(path.basename(filePath))} zip size: ${chalk.blueBright(`${(pointer / 1e6).toFixed(1)} MB`)}`
            )
        )
      }
    }

    scanDirectory(workingDir)
      .then(() => {
        clearInterval(Number(getConfigTimer))
        closeAllPools()
        return fs.readdir(TMP_PATH)
      })
      .then((fileNodes) =>
        process.env.NO_CLEAN
          ? Promise.resolve([])
          : Promise.all(fileNodes.map((fp) => fs.rm(path.resolve(TMP_PATH, fp), { recursive: true, force: true })))
      )
      .then(() => {
        configServerSocket.close()
        if (oneShotCheck && dryRunOneShotFiles) {
          console.log('dryRunOneShotFiles:')
          dryRunOneShotFiles.sort().forEach((dryFile) => console.log(dryFile))
        }
        process.exit(0)
      })
  },
  REMOTE_CONFIG_TIMEOUT
)
