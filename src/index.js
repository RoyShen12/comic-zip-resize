const fsModule = require('fs')
const path = require('path')

const { createWriteStream } = fsModule
const fs = fsModule.promises

const archiver = require('archiver')
const chalk = require('chalk')
const { v4: uuidV4 } = require('uuid')
const streamToBuffer = require('fast-stream-to-buffer')

const {
  quit,
  callRpc,
  logBeforeResize,
  logAfterResize,
  logWhileChangeServer,
  logAfterSkipped,
  logStartFileProcess,
  travelZipFile,
} = require('./util')
const { createRandomPicker, closeAllPools, choosePool } = require('./threads-helper')

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
const { timeProbe } = require('./debug')

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
        } else if (subStat.isFile() && !subStat.isSymbolicLink() && subFile.endsWith('.zip')) {
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
      await fs.mkdir(tempPath, { recursive: true })
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

      for await (const { type, entry, fileStream } of travelZipFile(filePath, {
        afterOpen(zipFile) {
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
          if (zipDirCount > 1) {
            quit('error get zipDirCount > 1 in one file')
          }
        } else {
          const { name: entryName, ext: entryExtName, base: entryBaseName } = path.parse(entry.fileName)

          if (entryExtName === '.db' || entryName.startsWith('.')) {
            // just skip it
            trashFileCount++
            continue
          }

          if (!fileStream) {
            throw new Error(`cannot get ${entry.fileName}'s fileStream`)
          }

          const entryWritePath = path.resolve(tempPath, entryBaseName)
          const resizedName = `${entryName}-lowQ${entryExtName}`
          const resizedPath = path.resolve(tempPath, resizedName)

          /**
           * @type {Buffer}
           */
          const entryBuffer = await new Promise((res, rej) => {
            streamToBuffer(fileStream, (err, buf) => {
              if (err) rej(err)
              else res(buf)
            })
          })

          const sourceSize = entryBuffer.byteLength
          if (sourceSize <= SHARP_MIN_SIZE * 1024) {
            // skip resize
            await fs.writeFile(entryWritePath, entryBuffer)
            processedEntries++
            skippedEntries++
            logAfterSkipped(thisIndex, fileIndex, processedEntries, getActualFileCount(), filePath, entry)
            continue
          }

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
                    : // @ts-ignore
                      ({ sourceBuffer, destPath, ip, port }) => require('./src/rpc-resize')(sourceBuffer, destPath, ip, port)
                )
                .setTransferList([entryBuffer.buffer])
                .exec({
                  sourceBuffer: entryBuffer,
                  destPath: resizedPath,
                  ip: selectedPool.ip,
                  port: selectedPool.port,
                })
            } catch (error) {
              const oldSelectedPool = { ...selectedPool }
              const oldIsLocal = isLocal

              ;[selectedPool, isLocal] = await choosePool(() => randomDispatcher, oldSelectedPool)
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
      }

      if (processedEntries < getActualFileCount()) {
        throw new Error(`processedFile ${processedEntries} < actualFile ${getActualFileCount()}`)
      }

      const hasNoChange = skippedEntries === getActualFileCount()

      console.log(chalk.greenBright(`${path.basename(filePath)} unzip and resize finished`))

      if (hasNoChange) {
        console.log(chalk.yellowBright(`${path.basename(filePath)} no change and skip zipping`))
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
              `${chalk.greenBright(path.basename(filePath))} zip size: ${chalk.blueBright(
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

          console.log(`${chalk.cyanBright(path.basename(filePath))} ${chalk.greenBright('start zipping')}`)

          archive.directory(tempPath, false)

          archive.finalize()
        })
      }
    }

    scanDirectory(workingDir)
      .then(() => {
        clearInterval(Number(getConfigTimer))
        closeAllPools()
        return fs.readdir(TMP_PATH)
      })
      .then((fileNodes) => {
        return Promise.all(fileNodes.map((fp) => fs.rm(path.resolve(TMP_PATH, fp), { recursive: true, force: true })))
      })
      .then(() => {
        configServerSocket.close()
        process.exit(0)
      })
  },
  REMOTE_CONFIG_TIMEOUT
)
