const fsModule = require('fs')
const path = require('path')

const { createWriteStream } = fsModule
const fs = fsModule.promises

const archiver = require('archiver')
const chalk = require('chalk')
const yauzl = require('yauzl')
const { v4: uuidV4 } = require('uuid')
const { DynamicPool } = require('node-worker-threads-pool')

const { JPEG_MAX_MEM, TMP_PATH } = require('./config')

const JPEG = require('jpeg-js')
const Jimp = require('jimp')
Jimp.decoders['image/jpeg'] = (data) =>
  JPEG.decode(data, { maxMemoryUsageInMB: JPEG_MAX_MEM })

const utils = require('./util')
const { ResizeMachine } = utils

const { remoteServer, localThread: localThreadsCount } = require('./config')
const localDynamicPool = new DynamicPool(localThreadsCount)
const remoteDynamicPools = remoteServer.map(
  (srv) => new DynamicPool(srv.threads)
)

const threadWeight = [localThreadsCount, ...remoteServer.map((s) => s.threads)]
const Solution = require('./random-with-weight')
const randomMachine = new Solution(threadWeight)

const randomDispatcher = () => {
  const index = randomMachine.pickIndex()
  if (index === 0) return { pool: localDynamicPool, mark: ResizeMachine.Local }
  else
    return {
      pool: remoteDynamicPools[index - 1],
      mark: ResizeMachine.Remote,
      remoteIndex: index - 1,
      ip: remoteServer[index - 1].ip,
    }
}

const workingDir = process.argv[2]

if (!workingDir) {
  utils.quit('working dir is empty')
}

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

                    // thread
                    const getPool = randomDispatcher()
                    const isLocal = getPool.mark === ResizeMachine.Local

                    console.log(
                      `<${String(thisIndex).padStart(
                        String(fileIndex).length,
                        ' '
                      )}> ${path.basename(filePath)}/${chalk.blueBright(
                        entry.fileName
                      )} dispatch to [${
                        isLocal
                          ? chalk.magentaBright('L ')
                          : chalk.cyanBright('R' + getPool.remoteIndex)
                      }]`
                    )

                    const cost = await getPool.pool.exec({
                      task: isLocal
                        ? ({ sourcePath, destPath }) => {
                            // ==================== Thread Scope ====================
                            return require('./local-resize')(
                              sourcePath,
                              destPath
                            )
                            // ==================== End Thread Scope ====================
                          }
                        : ({ sourcePath, destPath, ip }) => {
                            // ==================== Thread Scope ====================
                            return require('./rpc-resize')(
                              sourcePath,
                              destPath,
                              ip
                            )
                            // ==================== End Thread Scope ====================
                          },
                      param: {
                        sourcePath: entryWritePath,
                        destPath: resizedPath,
                        ip: getPool.ip,
                      },
                    })

                    const processSpeed = sourceSize / cost / 1024

                    processedEntry++
                    console.log(
                      `<${String(thisIndex).padStart(
                        String(fileIndex).length,
                        ' '
                      )}> [${
                        isLocal
                          ? chalk.magentaBright('L ')
                          : chalk.cyanBright('R' + getPool.remoteIndex)
                      }] ${chalk.greenBright('resizing file')} (${String(
                        processedEntry
                      ).padStart(3, ' ')}/${String(entryCount).padStart(
                        3,
                        ' '
                      )}) ${path.basename(filePath)}/${chalk.blueBright(
                        entry.fileName
                      )} cost: ${chalk.yellowBright(
                        cost.toFixed(3)
                      )} sec, speed: ${chalk.redBright(
                        processSpeed.toFixed(1)
                      )} K/s`
                    )

                    if (processedEntry >= entryCount) {
                      res()
                    }
                  })
                })

                readStream.pipe(entryWriteStream)
              })
            }
          })

          // zipFile.on('close', () => {
          //   res()
          // })
        }
      )
    })

    console.log(
      chalk.greenBright(`${path.basename(filePath)} unzip and resize finished`)
    )

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
        res()
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
    localDynamicPool.destroy()
    remoteDynamicPools.forEach((p) => p.destroy())
    return fs.readdir(TMP_PATH)
  })
  .then((fps) =>
    fps.map((fp) =>
      fs.rm(path.resolve(TMP_PATH, fp), { recursive: true, force: true })
    )
  )
