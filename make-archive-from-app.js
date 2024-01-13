const fsModule = require('fs')
const path = require('path')

const chalk = require('chalk')
const { zipDirectoryWithThread } = require('./src/zip-helper')
const { getZipPool } = require('./src/threads-helper')

const fs = fsModule.promises

;(async () => {
  const getFolderSize = (await import('get-folder-size')).default

  const workingDir = process.argv[2]
  const pixivOutPath = process.argv[3]

  if (!workingDir) {
    console.error('cannot find workingDir (argv[2])')
    process.exit(-1)
  }

  console.log(`working dir: ${chalk.whiteBright(workingDir)}\n`)

  const seriesDirs = await fs.readdir(workingDir)
  const pixivPath = path.resolve(workingDir, 'pixiv')

  if (
    fsModule.existsSync(pixivPath) &&
    (await fs.stat(pixivPath)).isDirectory() &&
    fsModule.existsSync(path.resolve(workingDir, '.sync'))
  ) {
    if (!pixivOutPath) {
      console.error('cannot find pixivOutPath (argv[3])')
      process.exit(-1)
    }
    // is pixiv daily top50

    /**
     * work_dir |- .sync
     *          |- pixiv |- TOP50
     *                   |- TOP50_R18 |- 2022 |- 01 |- 01_daily_R18 |- 1aaa.jpg
     *                   |                                          |- 2bbb.png
     */

    const years = (await fs.readdir(path.resolve(pixivPath, 'TOP50_R18'), { withFileTypes: true }))
      .filter((f) => f.isDirectory())
      .map((f) => f.name)
    const taskList = []

    for (const year of years) {
      const months = (await fs.readdir(path.resolve(pixivPath, 'TOP50_R18', year), { withFileTypes: true }))
        .filter((f) => f.isDirectory())
        .map((f) => f.name)

      for (const month of months) {
        const days = (await fs.readdir(path.resolve(pixivPath, 'TOP50_R18', year, month), { withFileTypes: true }))
          .filter((f) => f.isDirectory())
          .map((f) => f.name)

        for (const day of days) {
          const dayPath = path.resolve(pixivPath, 'TOP50_R18', year, month, day)

          if ((await fs.readdir(dayPath)).length > 0) {
            const destFile = path.resolve(pixivOutPath, `${year}-${month}-${day}.zip`)

            taskList.push(
              (async () => {
                if (fsModule.existsSync(destFile)) {
                  console.log(`${chalk.yellowBright(destFile)} zip skipped`)
                  return
                }

                console.log(`${chalk.blueBright(destFile)} zip start`)
                const threadId = await zipDirectoryWithThread(dayPath, destFile)
                console.log(`[${chalk.bold(chalk.whiteBright(threadId))}] ${chalk.greenBright(destFile)} zip finish`)
              })()
            )
          }
        }
      }
    }

    await Promise.all(taskList)

    console.log('finish')
  } else {
    await Promise.all(
      seriesDirs.map(async (seriesName) => {
        const seriesPath = path.resolve(workingDir, seriesName)

        // is not dir
        if (!(await fs.stat(seriesPath)).isDirectory()) {
          if (seriesName === '.DS_Store') {
            await fs.unlink(seriesPath)
          } else {
            console.error(chalk.redBright(`meet node ${chalk.bold(seriesPath)} is not a dir`))
            process.exit(1)
          }
        }

        const waifuPath = path.resolve(seriesPath, 'waifu2x')
        const originalPath = path.resolve(seriesPath, 'original')
        const defaultPath = path.resolve(seriesPath, 'default')

        if (fsModule.existsSync(defaultPath)) {
          // is ehentai

          /**
           * work_dir |- series_a |- default |- 01.jpg
           *                                 |- 02.jpg
           *                                 |- 03.jpg
           *                                 |- 04.jpg
           */

          // check default has content and no dir
          const defaultSize = await getFolderSize.loose(defaultPath)
          if (defaultSize === 0) {
            console.error(chalk.redBright(`${defaultPath} has zero size`))
            process.exit(1)
          }
          if ((await fs.readdir(defaultPath, { withFileTypes: true })).some((f) => !f.isFile())) {
            console.error(chalk.redBright(`${defaultPath} has non file inside`))
            process.exit(1)
          }

          const chapterZipOutputPath = `${path.resolve(seriesPath, '..', seriesName)}.zip`
          console.log(`chapterZipOutputPath: ${chalk.cyanBright(chapterZipOutputPath)}`)

          const threadId = await zipDirectoryWithThread(defaultPath, chapterZipOutputPath)
          console.log(`[${chalk.bold(chalk.whiteBright(threadId))}] ${chalk.greenBright(seriesName)} zip finish`)
          await fs.rm(seriesPath, { recursive: true, force: true })
        } else {
          // is bika

          /**
           * work_dir |- series_a |- original |- Chapter01 |- 01.jpg
           *          |           |           |            |- 02.jpg
           *          |           |           |            |- 03.jpg
           *          |           |           |            |- 04.jpg
           *          |           |           |
           *          |           |           |- Chapter02 |- 01.jpg
           *          |                                    |- 02.jpg
           *          |                                    |- 03.jpg
           *          |           |
           *          |           |
           *          |           |- waifu2x  |- Chapter01 |- 01.jpg
           *          |                       |            |- 02.jpg
           *          |                       |            |- 03.jpg
           *          |                       |            |- 04.jpg
           *          |                       |
           *          |                       |- Chapter02 |- 01.jpg
           *          |                                    |- 02.jpg
           *          |                                    |- 03.jpg
           *          |
           *          |- series_b
           */

          // should have two sub dir named waifu2x and original
          const seriesSubDirs = await fs.readdir(seriesPath)
          if (seriesSubDirs.length < 1 || !seriesSubDirs.includes('waifu2x') || !(await fs.stat(waifuPath)).isDirectory()) {
            console.error(chalk.redBright(`${chalk.bold(seriesPath)}'s structure mismatch`))
            process.exit(1)
          }

          // check waifu2x has content
          const waifuSize = await getFolderSize.loose(waifuPath)
          if (waifuSize === 0) {
            console.error(chalk.redBright(`${waifuPath} has zero size`))
            process.exit(1)
          }

          // console.log(`${waifuPath} size: ${(waifuSize / 1e6).toFixed(1)} MB`)

          // delete original
          if (seriesSubDirs.includes('original') && (await fs.stat(originalPath)).isDirectory()) {
            await fs.rm(originalPath, { recursive: true, force: true })
            console.log(chalk.yellowBright(`${originalPath} deleted`))
          }

          // process chapter
          const chapters = await fs.readdir(waifuPath)
          await Promise.all(
            chapters.map(async (chapterName) => {
              // work_dir |- series_a |- waifu2x |- Chapter01 |- 01.jpg
              const chapterFullPath = path.resolve(waifuPath, chapterName)
              // create zip files
              const chapterFullName = `${seriesName} - ${chapterName}`
              console.log(`chapterFullName: ${chalk.cyanBright(chapterFullName)}`)

              const chapterZipOutputPath =
                chapters.length === 1
                  ? `${path.resolve(seriesPath, '..', chapterFullName)}.zip`
                  : `${path.resolve(seriesPath, chapterFullName)}.zip`
              console.log(`chapterZipOutputPath: ${chalk.cyanBright(chapterZipOutputPath)}`)

              const threadId = await zipDirectoryWithThread(chapterFullPath, chapterZipOutputPath)
              console.log(`[${chalk.bold(chalk.whiteBright(threadId))}] ${chalk.greenBright(chapterFullName)} zip finish`)
            })
          )

          // remove empty folder
          if (chapters.length === 1) {
            await fs.rm(seriesPath, { recursive: true, force: true })
          } else {
            await fs.rm(waifuPath, { recursive: true, force: true })
          }

          // log to finish
          console.log(chalk.yellowBright(`${chapters.length === 1 ? seriesPath : waifuPath} deleted`))
        }
      })
    )

    console.log('all dir finish')
  }

  await getZipPool().destroy()
  process.exit(0)
})()
