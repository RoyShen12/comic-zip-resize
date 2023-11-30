const fsModule = require('fs')
const path = require('path')
const os = require('os')

const { createWriteStream } = fsModule
const fs = fsModule.promises

const archiver = require('archiver')
const chalk = require('chalk')
const yauzl = require('yauzl')
const { v4: uuidV4 } = require('uuid')
const { DynamicPool } = require('node-worker-threads-pool')

const utils = require('./util')
const { ResizeMachine } = utils

const localThreadsCount = os.cpus().length - 1
const remoteThreadsCount = 11
const remoteAddress = '192.168.50.59'
const localDynamicPool = new DynamicPool(localThreadsCount)
const remoteDynamicPool = new DynamicPool(remoteThreadsCount)
const randomDispatcher = () => {
  const r = Math.random()
  if (r < localThreadsCount / (localThreadsCount + remoteThreadsCount))
    return { pool: localDynamicPool, mark: ResizeMachine.Local }
  else return { pool: remoteDynamicPool, mark: ResizeMachine.Remote }
}

const workingDir = process.argv[2]

if (!workingDir) {
  utils.quit('working dir is empty')
}

async function scanDirectory(pathParam) {
  console.log(`scan dir: ${chalk.blueBright(pathParam)}`)
  const subFiles = await fs.readdir(pathParam)

  await Promise.all(
    subFiles.map(async (subFile) => {
      const subPath = path.resolve(pathParam, subFile)
      const subStat = await fs.stat(subPath)

      if (subStat.isDirectory()) {
        return await scanDirectory(subPath)
      } else if (
        subStat.isFile() &&
        !subStat.isSymbolicLink() &&
        subFile.endsWith('.zip')
      ) {
        return await scanZipFile(subPath)
      }
    })
  )
}

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
    const id = uuidV4()
    const tempPath = path.resolve(
      '/share/ZFS18_DATA/homes/roy/bin/temp/image',
      id
    )
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
                }

                readStream.on('end', function () {
                  zipFile.readEntry()

                  // thread
                  const getPool = randomDispatcher()
                  const isLocal = getPool.mark === ResizeMachine.Local
                  getPool.pool
                    .exec({
                      task: isLocal
                        ? async ({ sourcePath, destPath }) => {
                            // ==================== Thread Scope ====================
                            const cost = await require('./local-resize')(
                              sourcePath,
                              destPath
                            )

                            const fsModule = require('fs')
                            const fs = fsModule.promises

                            await fs.rm(sourcePath)

                            return cost
                            // ==================== End Thread Scope ====================
                          }
                        : async ({ sourcePath, destPath, ip }) => {
                            // ==================== Thread Scope ====================
                            const cost = await require('./rpc-resize')(
                              sourcePath,
                              destPath,
                              ip
                            )

                            const fsModule = require('fs')
                            const fs = fsModule.promises

                            await fs.rm(sourcePath)

                            return cost
                            // ==================== End Thread Scope ====================
                          },
                      param: {
                        sourcePath: entryWritePath,
                        destPath: resizedPath,
                        ip,
                      },
                    })
                    .then((cost) => {
                      processedEntry++
                      console.log(
                        `[${
                          isLocal
                            ? chalk.magentaBright('L')
                            : chalk.cyanBright('R')
                        }] ${chalk.greenBright(
                          'resizing file'
                        )} (${processedEntry}/${entryCount}) ${path.basename(
                          filePath
                        )}/${entry.fileName} cost: ${chalk.yellowBright(
                          cost.toFixed(3)
                        )} sec`
                      )
                      if (processedEntry >= entryCount) {
                        res()
                      }
                    })
                })

                readStream.pipe(createWriteStream(entryWritePath))
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
      const archive = archiver('zip')

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

scanDirectory(workingDir).then(() => {
  localDynamicPool.destroy()
})
