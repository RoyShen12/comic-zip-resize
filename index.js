const fsModule = require('fs')
const path = require('path')

const { createWriteStream } = fsModule
const fs = fsModule.promises

const archiver = require('archiver')
const chalk = require('chalk')
const yauzl = require('yauzl')
const { v4: uuidV4 } = require('uuid')
const { DynamicPool } = require('node-worker-threads-pool')

const {
  ResizeMachine,
  quit,
  sleep,
  callRpc,
  logBeforeResize,
  logAfterResize,
  logWhileChangeServer,
  poolIsIdle,
  waitForPoolIdle,
} = require('./util')

const workingDir = process.argv[2]

if (!workingDir) {
  quit('working dir is empty')
}

const rpc = require('axon-rpc')
const axon = require('axon')

const Solution = require('./random-with-weight')

const {
  TMP_PATH,
  localThread: localThreadsCount,
  registryServer,
  REMOTE_CONFIG_REFRESH,
  REMOTE_CONFIG_TIMEOUT,
} = require('./config')

const localDynamicPool =
  localThreadsCount > 0 ? new DynamicPool(localThreadsCount) : null
/**
 * @type {Map<string, DynamicPool>}
 */
const activeRemoteDynamicPools = new Map()
/**
 * @type {Map<string, DynamicPool>}
 */
const inactiveRemoteDynamicPools = new Map()

const getAllUsablePools = () =>
  localDynamicPool
    ? [localDynamicPool, ...activeRemoteDynamicPools.values()]
    : [...activeRemoteDynamicPools.values()]

/**
 * @param {{ip: string; port: number; threads: number}[]} remoteServer
 */
const createRandomPicker = (remoteServer) => {
  remoteServer.forEach((srv) => {
    const ipPort = `${srv.ip}:${srv.port}`
    if (!activeRemoteDynamicPools.has(ipPort)) {
      /**
       * @type {DynamicPool}
       */
      // @ts-ignore
      const pool = inactiveRemoteDynamicPools.has(ipPort)
        ? inactiveRemoteDynamicPools.get(ipPort)
        : new DynamicPool(srv.threads)
      inactiveRemoteDynamicPools.delete(ipPort)
      activeRemoteDynamicPools.set(ipPort, pool)
    }
  })

  activeRemoteDynamicPools.forEach((pool, ipPort) => {
    if (
      remoteServer.findIndex((srv) => {
        const remoteIpPort = `${srv.ip}:${srv.port}`
        return remoteIpPort === ipPort
      }) === -1
    ) {
      inactiveRemoteDynamicPools.set(ipPort, pool)
      activeRemoteDynamicPools.delete(ipPort)
    }
  })

  const threadWeight = [
    localThreadsCount,
    ...Array.from(activeRemoteDynamicPools.keys()).map((ipPort) => {
      const ip = ipPort.split(':')[0]
      return remoteServer.find((srv) => srv.ip === ip)?.threads
    }),
  ]
  const randomMachine = new Solution(threadWeight)

  /**
   * @returns {{pool: DynamicPool | null; mark: number; remoteIndex?: number; ip?: string; port?: number}}
   */
  return () => {
    const index = randomMachine.pickIndex()

    if (index === 0) {
      return { pool: localDynamicPool, mark: ResizeMachine.Local }
    } else {
      const remoteIndex = index - 1
      return {
        pool: Array.from(activeRemoteDynamicPools.values())[remoteIndex],
        mark: ResizeMachine.Remote,
        remoteIndex,
        ip: remoteServer[remoteIndex].ip,
        port: remoteServer[remoteIndex].port,
      }
    }
  }
}

// request registry server for remote server information
const configServerSocket = axon.socket('req')
const configServerClient = new rpc.Client(configServerSocket)
configServerSocket.connect(registryServer.port, registryServer.ip)

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

    console.log('fetch remoteServer', remoteServer)

    let randomDispatcher = createRandomPicker(remoteServer)

    const getConfigInst = setInterval(() => {
      callRpc(
        configServerClient,
        'getMethodConfig',
        ['resize'],
        (err, remoteServer) => {
          if (!err && remoteServer) {
            // console.log(
            //   'refresh remote server list',
            //   remoteServer
            //     .map(
            //       (s) =>
            //         `${chalk.greenBright(
            //           `${s.ip}:${s.port}`
            //         )}@${chalk.yellowBright(`${s.threads}C`)}`
            //     )
            //     .join(','),
            //   'all pools',
            //   getAllUsablePools().length
            // )
            randomDispatcher = createRandomPicker(remoteServer)
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

    let fileIndex = 0

    // make 0.5x zip with (LowQuality) file name
    async function scanZipFile(filePath) {
      const fileBaseName = path.basename(filePath)
      const filePathParsed = path.parse(filePath)
      const fileLowQualityPath = `${filePathParsed.dir}/${filePathParsed.name} (LowQuality)${filePathParsed.ext}`

      if (
        !fileBaseName.includes('(LowQuality)') &&
        (await fs.readdir(filePathParsed.dir))
          .filter((fp) => fp !== fileBaseName)
          .every((fp) => {
            return path.parse(fp).name !== path.parse(fileLowQualityPath).name
          })
      ) {
        fileIndex++
        const thisIndex = fileIndex
        const id = uuidV4()
        const tempPath = path.resolve(TMP_PATH, id)
        await fs.mkdir(tempPath, { recursive: true })
        console.log(
          `process file: ${chalk.cyanBright(filePath)} -> ${chalk.whiteBright(
            tempPath
          )}`
        )

        // promise of unzip and write files and resize files
        await new Promise((res, rej) => {
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
                rej(err)
                return
              }

              const { entryCount } = zipFile
              let processedEntry = 0

              zipFile.readEntry()

              zipFile.on('entry', function (entry) {
                if (/\/$/.test(entry.fileName)) {
                  console.log(
                    `${chalk.yellowBright('entry(dir)')}: ${chalk.gray(
                      entry.fileName
                    )}`
                  )
                  // Directory file names end with '/'.
                  // Note that entires for directories themselves are optional.
                  // An entry's fileName implicitly requires its parent directories to exist.
                  zipFile.readEntry()
                } else {
                  // file entry
                  // console.log(`entry: ${chalk.gray(entry.fileName)}`)
                  const entryWritePath = path.resolve(tempPath, entry.fileName)
                  const { name: entryBaseName, ext: entryExtName } = path.parse(
                    entry.fileName
                  )
                  const resizedName = `${entryBaseName}-lowQ${entryExtName}`
                  const resizedPath = path.resolve(tempPath, resizedName)

                  zipFile.openReadStream(entry, function (err, readStream) {
                    if (err) {
                      rej(err)
                      return
                    }

                    const entryWriteStream = createWriteStream(entryWritePath, {
                      highWaterMark: 1024 * 1024 * 4,
                    })

                    entryWriteStream.on('finish', () => {
                      zipFile.readEntry()

                      entryWriteStream.close(async (err) => {
                        if (err) {
                          rej(err)
                          return
                        }

                        const sourceSize = (await fs.stat(entryWritePath)).size

                        let cost = undefined
                        // thread
                        let selectedPool = undefined
                        while (!selectedPool || !selectedPool.pool) {
                          selectedPool = randomDispatcher()
                          if (!poolIsIdle(selectedPool.pool)) {
                            selectedPool = undefined
                            if (
                              getAllUsablePools().length === 0 ||
                              getAllUsablePools().every(
                                (pool) => !poolIsIdle(pool)
                              )
                            ) {
                              await sleep(100)
                            }
                          }
                        }
                        let isLocal = selectedPool.mark === ResizeMachine.Local

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
                                ? ({ sourcePath, destPath }) => {
                                    // ==================== Thread Scope ====================
                                    return require('./local-resize')(
                                      sourcePath,
                                      destPath
                                    )
                                    // ==================== End Thread Scope ====================
                                  }
                                : ({ sourcePath, destPath, ip, port }) => {
                                    // ==================== Thread Scope ====================
                                    return require('./rpc-resize')(
                                      sourcePath,
                                      destPath,
                                      ip,
                                      port
                                    )
                                    // ==================== End Thread Scope ====================
                                  },
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
                            selectedPool = undefined
                            while (!selectedPool || !selectedPool.pool) {
                              selectedPool = randomDispatcher()
                              if (
                                selectedPool.pool === oldSelectedPool.pool ||
                                !poolIsIdle(selectedPool.pool)
                              ) {
                                selectedPool = undefined
                                if (
                                  getAllUsablePools().length === 0 ||
                                  getAllUsablePools().every(
                                    (pool) => !poolIsIdle(pool)
                                  )
                                ) {
                                  await sleep(100)
                                }
                              }
                            }
                            isLocal = selectedPool.mark === ResizeMachine.Local
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

                        processedEntry++

                        logAfterResize(
                          thisIndex,
                          fileIndex,
                          isLocal,
                          selectedPool,
                          processedEntry,
                          entryCount,
                          filePath,
                          entry,
                          cost,
                          processSpeed
                        )

                        if (processedEntry >= entryCount) {
                          res(undefined)
                        }
                      })
                    })

                    readStream.pipe(entryWriteStream)
                  })
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

        // promise of zip resized files
        await new Promise((res, rej) => {
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
            res(undefined)
          })

          archive.on('warning', function (err) {
            if (err.code === 'ENOENT') {
              console.log(chalk.redBright('archive on warning: ENOENT'))
              console.error(err)
            } else {
              rej(err)
            }
          })

          archive.on('error', function (err) {
            rej(err)
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

    scanDirectory(workingDir)
      .then(() => {
        clearInterval(Number(getConfigInst))
        localDynamicPool?.destroy()
        activeRemoteDynamicPools.forEach((p) => p.destroy())
        inactiveRemoteDynamicPools.forEach((p) => p.destroy())
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
