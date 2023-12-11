const fsModule = require('fs')
const path = require('path')
const { inspect } = require('util')

const fs = fsModule.promises

const chalk = require('chalk')
const { v4: uuidV4 } = require('uuid')
const sharp = require('sharp')

const { closeAllPools } = require('./src/threads-helper')
const { TMP_PATH } = require('./src/config')
const { getZipTree, makeExtDict, rezipFile, moveUpFilesAndDeleteEmptyFolders } = require('./src/util')

const workingDir = process.argv[2]
const silenceMode = process.argv.includes('--silence')

async function scanDirectory(pathParam) {
  if (!silenceMode) console.log(`scan dir: ${chalk.blueBright(pathParam)}`)
  const subFiles = (await fs.readdir(pathParam)).filter((subFile) => subFile !== '.DS_Store')

  for (const subFile of subFiles) {
    const subPath = path.resolve(pathParam, subFile)

    const subPathStat = await fs.stat(subPath)

    if (subPathStat.isDirectory()) {
      await scanDirectory(subPath)
    } else if (subPathStat.isFile() && !subPathStat.isSymbolicLink() && subFile.endsWith('.zip')) {
      try {
        await scanZipFile(subPath)
      } catch (error) {
        console.log(chalk.redBright(`error on file ${subPath}:`))
        console.log(error)
      }
    }
  }
}

let fileIndex = 0
/**
 * @param {string} filePath
 */
async function scanZipFile(filePath) {
  fileIndex++
  if (!silenceMode) console.log(`scan file: ${chalk.magentaBright(filePath)}`)

  const fileTree = await getZipTree(filePath)
  const fileList = fileTree.getAllFiles()
  const fileExtDict = makeExtDict(fileList)
  const fileExtList = Object.keys(fileExtDict)

  let modifyFlag = false

  if (fileExtList.length > 1 || fileExtList[0] !== '.jpg') {
    modifyFlag = true
    console.log(
      `[${fileIndex}] ${chalk.cyanBright(path.parse(filePath).base)} file list length ${chalk.bold(
        fileList.length
      )}, extensions: ${inspect(fileExtDict, {
        depth: Infinity,
        colors: true,
        breakLength: Infinity,
      })}`
    )
  }
  // 只处理 Zip 中的文件，目录，提升唯一根目录
  // 不分隔多章节
  if (fileTree.hasOnlyRoot()) {
    modifyFlag = true
  }
  if (fileTree.getAllDirs().length > 1) {
    console.warn(chalk.redBright(`(only warning) zip file ${chalk.bold(filePath)} has over one dirs`))
  }
  if (fileTree.getAllDirs().includes('__MACOSX/')) {
    modifyFlag = true
    console.log(`[${fileIndex}] ${chalk.cyanBright(path.parse(filePath).base)} ${chalk.yellowBright('has MacOS special dir')}`)
  }

  if (modifyFlag) {
    console.log(chalk.yellowBright(chalk.bold(`get modifyFlag, will rezip ${filePath}`)))

    const id = uuidV4()
    const tempPath = path.resolve(TMP_PATH, id)
    if (!fsModule.existsSync(tempPath)) await fs.mkdir(tempPath, { recursive: true })

    /**
     * 1. Rezip bad file name encoding zip (BGK)
     * 2. transform *.png, *.bmp, *.JPG, *.webm, *.webp to standard sharp.JPEG
     * 3. remove useless __MACOSX/, *.url, *.db, *.txt ...
     * 4. remove only one root dir if it has
     */
    await rezipFile(
      filePath,
      {
        async transformDir(dirPath, stat) {
          const isRootDir = path.parse(dirPath).dir === tempPath
          if (isRootDir && fileTree.hasOnlyRoot()) {
            console.log(`transformDir do [moveUpFilesAndDeleteEmptyFolders] to ${tempPath}`)
            await moveUpFilesAndDeleteEmptyFolders(tempPath)
            return 2
          }
          if (stat.isDirectory() && !stat.isSymbolicLink() && path.parse(dirPath).base === '__MACOSX') {
            console.log(`transformDir do rmdir to ${dirPath}`)
            await fs.rm(dirPath, { recursive: true, force: true })
            return 1
          }
          return 0
        },
        async transformFile(filePath) {
          const parsedFileName = path.parse(filePath)
          // remove *.url, *.db, *.txt
          const trashExt = ['.url', '.db', '.txt']
          if (trashExt.some((e) => parsedFileName.ext === e)) {
            console.log(`transformFile do rm to ${filePath}`)
            await fs.rm(filePath)
          }
          // transform *.png, *.bmp, *.JPG, *.webm, *.webp to standard sharp.JPEG
          const badImgExt = ['.JPG', ...['.png', '.bmp', '.webm', '.webp'].map((e) => [e, e.toUpperCase()]).flat()]
          if (badImgExt.some((e) => parsedFileName.ext === e)) {
            console.log(`transformFile do transform JPEG to ${filePath}`)
            await fs.writeFile(
              path.resolve(parsedFileName.dir, `${parsedFileName.name}.jpg`),
              await sharp(await fs.readFile(filePath))
                .jpeg({
                  quality: 86,
                })
                .toBuffer()
            )
            await fs.rm(filePath)
          }
        },
      },
      tempPath
    )
    console.log(chalk.greenBright(chalk.bold(`${filePath} finish`)))
  }
}

scanDirectory(workingDir)
  .then(() => {
    closeAllPools()
    return fs.readdir(TMP_PATH)
  })
  .then((fileNodes) =>
    process.env.NO_CLEAN
      ? Promise.resolve([])
      : Promise.all(fileNodes.map((fp) => fs.rm(path.resolve(TMP_PATH, fp), { recursive: true, force: true })))
  )
  .then(() => {
    process.exit(0)
  })
