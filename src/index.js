const fsModule = require('fs')
const path = require('path')

const { createWriteStream } = fsModule
const fs = fsModule.promises

const archiver = require('archiver')
const chalk = require('chalk')
const yauzl = require('yauzl')
const { v4: uuidV4 } = require('uuid')

const {
  quit,
  callRpc,
  logBeforeResize,
  logAfterResize,
  logWhileChangeServer,
  logAfterSkipped,
  logStartFileProcess,
  createRandomPicker,
  closeAllPools,
  choosePool,
} = require('./util')

const workingDir = process.argv[2]

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
} = require('./config')

// request registry server for remote server information
const configServerSocket = axon.socket('req')
const configServerClient = new configRpc.Client(configServerSocket)
configServerSocket.connect(registryServer.port, registryServer.ip)

let fileIndex = 0

callRpc(
  configServerClient,
  'getMethodConfig',
  ['resize'],
  /**
   * @param {Error | null} err
   * @param {{ip: string, port: number, threads: number}[]} remoteServer
   */
  (err, remoteServer) => {
    if (err || !remoteServer) {
      console.log(err)
      quit('get "getMethodConfig" failed!')
    }

    const randomDispatcher = { fn: createRandomPicker(remoteServer) }
    const getConfigTimer = setInterval(() => {
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

    async function scanDirectory(pathParam) {
      console.log(`scan dir: ${chalk.blueBright(pathParam)}`)
      const subFiles = await fs.readdir(pathParam)

      for (const subFile of subFiles) {
        const subPath = path.resolve(pathParam, subFile)
        const subStat = await fs.stat(subPath)

        if (subStat.isDirectory()) {
          await scanDirectory(subPath)
        } else if (
          subStat.isFile() &&
          !subStat.isSymbolicLink() &&
          subFile.endsWith('.zip')
        ) {
          await scanZipFile(subPath)
        }
      }

      // await Promise.all(subFiles.map(async (subFile) => {}))
    }

    /**
     * make 0.5x zip with $SHARP_FILE_NAME_SUFFIX file name
     * @param {string} filePath
     */
    async function scanZipFile(filePath) {
      const fileBaseName = path.basename(filePath)
      const filePathParsed = path.parse(filePath)
      const fileLowQualityPath = `${filePathParsed.dir}/${filePathParsed.name} ${SHARP_FILE_NAME_SUFFIX}${filePathParsed.ext}`

      if (
        !fileBaseName.includes(SHARP_FILE_NAME_SUFFIX) &&
        (await fs.readdir(filePathParsed.dir))
          .filter((fp) => fp !== fileBaseName)
          .every(
            (fp) => path.parse(fp).name !== path.parse(fileLowQualityPath).name
          )
      ) {
        fileIndex++
        const thisIndex = fileIndex
        const id = uuidV4()
        const tempPath = path.resolve(TMP_PATH, id)
        await fs.mkdir(tempPath, { recursive: true })
        logStartFileProcess(filePath, tempPath)

        // promise of unzip and write files and resize files
        const hasNoChange = await new Promise((unzipRes, unzipRej) => {
          yauzl.open(
            filePath,
            {
              autoClose: true,
              lazyEntries: true,
              decodeStrings: true,
              validateEntrySizes: true,
              strictFileNames: false,
            },
            (err, zipFile) => {
              if (err) {
                unzipRej(err)
                return
              }

              const { entryCount } = zipFile
              let zipDirCount = 0
              let trashFileCount = 0
              let processedEntries = 0
              let skippedEntries = 0
              const getActualFileCount = () =>
                entryCount - zipDirCount - trashFileCount

              zipFile.readEntry()

              zipFile.on('entry', function (entry) {
                if (/\/$/.test(entry.fileName)) {
                  // dir entry
                  console.log(
                    `${chalk.yellowBright('entry(dir)')}: ${chalk.gray(
                      entry.fileName
                    )}`
                  )
                  zipDirCount++
                  if (zipDirCount > 1) {
                    quit('error get zipDirCount > 1 in one file')
                  }
                  zipFile.readEntry()
                } else {
                  // file entry
                  const {
                    name: entryBaseName,
                    ext: entryExtName,
                    base: entryName,
                  } = path.parse(entry.fileName)

                  if (entryExtName === '.db') {
                    // just skip it
                    trashFileCount++
                    zipFile.readEntry()
                  } else {
                    const entryWritePath = path.resolve(tempPath, entryName)
                    const resizedName = `${entryBaseName}-lowQ${entryExtName}`
                    const resizedPath = path.resolve(tempPath, resizedName)

                    zipFile.openReadStream(entry, function (err, readStream) {
                      if (err) {
                        unzipRej(err)
                        return
                      }

                      const entryWriteStream = createWriteStream(
                        entryWritePath,
                        {
                          highWaterMark: 1024 * 1024 * 4,
                        }
                      )

                      entryWriteStream.on('finish', () => {
                        zipFile.readEntry()

                        entryWriteStream.close(async (err) => {
                          if (err) {
                            unzipRej(err)
                            return
                          }

                          const sourceSize = (await fs.stat(entryWritePath))
                            .size

                          if (sourceSize >= SHARP_MIN_SIZE * 1024) {
                            let cost = undefined
                            // thread
                            let [selectedPool, isLocal] = await choosePool(
                              () => randomDispatcher
                            )

                            let retried = 0
                            while (cost === undefined) {
                              logBeforeResize(
                                thisIndex,
                                fileIndex,
                                filePath,
                                entry,
                                isLocal,
                                selectedPool
                              )

                              try {
                                cost = await selectedPool.pool.exec({
                                  task: isLocal
                                    ? ({ sourcePath, destPath }) =>
                                        require('./local-resize')(
                                          sourcePath,
                                          destPath
                                        )
                                    : ({ sourcePath, destPath, ip, port }) =>
                                        require('./rpc-resize')(
                                          sourcePath,
                                          destPath,
                                          ip,
                                          port
                                        ),
                                  param: {
                                    sourcePath: entryWritePath,
                                    destPath: resizedPath,
                                    ip: selectedPool.ip,
                                    port: selectedPool.port,
                                  },
                                })
                              } catch (error) {
                                const oldSelectedPool = { ...selectedPool }
                                const oldIsLocal = isLocal

                                ;[selectedPool, isLocal] = await choosePool(
                                  () => randomDispatcher,
                                  oldSelectedPool
                                )
                                retried++

                                logWhileChangeServer(
                                  thisIndex,
                                  fileIndex,
                                  filePath,
                                  entry,
                                  isLocal,
                                  selectedPool,
                                  oldIsLocal,
                                  oldSelectedPool,
                                  retried,
                                  error
                                )
                              }
                            }

                            const processSpeed = sourceSize / cost / 1024

                            processedEntries++

                            logAfterResize(
                              thisIndex,
                              fileIndex,
                              isLocal,
                              selectedPool,
                              processedEntries,
                              getActualFileCount(),
                              filePath,
                              entry,
                              cost,
                              processSpeed
                            )
                          } else {
                            // skip resize
                            processedEntries++
                            skippedEntries++
                            logAfterSkipped(
                              thisIndex,
                              fileIndex,
                              processedEntries,
                              getActualFileCount(),
                              filePath,
                              entry
                            )
                          }

                          if (processedEntries >= getActualFileCount()) {
                            unzipRes(skippedEntries === getActualFileCount())
                          }
                        })
                      })

                      readStream.pipe(entryWriteStream)
                    })
                  }
                }
              })

              zipFile.on('close', () => {
                console.log(
                  `<${String(thisIndex).padStart(
                    String(fileIndex).length,
                    ' '
                  )}> ${path.basename(filePath)} ${chalk.greenBright(
                    'read finish'
                  )}`
                )
              })
            }
          )
        })

        console.log(
          chalk.greenBright(
            `${path.basename(filePath)} unzip and resize finished`
          )
        )

        if (hasNoChange) {
          console.log(
            chalk.yellowBright(
              `${path.basename(filePath)} no change and skip zipping`
            )
          )
        } else {
          // promise of zip resized files
          await new Promise((zipRes, zipRej) => {
            const output = createWriteStream(fileLowQualityPath)
            const archive = archiver('zip', {
              zlib: {
                level: 0,
              },
            })

            output.on('close', function () {
              console.log(
                `${chalk.greenBright(
                  path.basename(filePath)
                )} zip size: ${chalk.blueBright(
                  `${(archive.pointer() / 1e6).toFixed(1)} MB`
                )}`
              )
              zipRes(undefined)
            })

            archive.on('warning', function (err) {
              if (err.code === 'ENOENT') {
                console.log(chalk.redBright('archive on warning: ENOENT'))
                console.error(err)
              } else {
                zipRej(err)
              }
            })

            archive.on('error', function (err) {
              zipRej(err)
            })

            archive.pipe(output)

            console.log(
              `${chalk.cyanBright(path.basename(filePath))} ${chalk.greenBright(
                'start zipping'
              )}`
            )

            archive.directory(tempPath, false)

            archive.finalize()
          })
        }
      }
    }

    scanDirectory(workingDir)
      .then(() => {
        clearInterval(Number(getConfigTimer))
        closeAllPools()
        return fs.readdir(TMP_PATH)
      })
      .then((fileNodes) =>
        fileNodes.map((fp) =>
          fs.rm(path.resolve(TMP_PATH, fp), { recursive: true, force: true })
        )
      )
      .then(() => {
        configServerSocket.close()
        process.exit(0)
      })
  },
  REMOTE_CONFIG_TIMEOUT
)
