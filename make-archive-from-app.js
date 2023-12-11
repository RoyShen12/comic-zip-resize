const fsModule = require('fs')
const path = require('path')

const chalk = require('chalk')
const { zipDirectory, zipDirectoryWithThread } = require('./src/zip-helper')
const { getZipPool } = require('./src/threads-helper')

const { createWriteStream } = fsModule
const fs = fsModule.promises

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

;(async () => {
  const getFolderSize = (await import('get-folder-size')).default

  const workingDir = process.argv[2] || 'C:\\Users\\RoyShen\\Downloads\\bika_v1.4.3_windows_x64\\DL\\commies' || process.cwd()

  console.log(`working dir: ${chalk.whiteBright(workingDir)}\n`)

  const seriesDirs = await fs.readdir(workingDir)

  await Promise.all(
    seriesDirs.map(async (seriesName) => {
      const seriesPath = path.resolve(workingDir, seriesName)

      // is dir
      if (!(await fs.stat(seriesPath)).isDirectory()) {
        console.error(chalk.redBright(`meet node ${chalk.bold(seriesPath)} is not a dir`))
        process.exit(1)
      }

      const waifuPath = path.resolve(seriesPath, 'waifu2x')
      const originalPath = path.resolve(seriesPath, 'original')
      const defaultPath = path.resolve(seriesPath, 'default')

      if (fsModule.existsSync(defaultPath)) {
        // is ehentai

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

  await getZipPool().destroy()
  process.exit(0)
})()
