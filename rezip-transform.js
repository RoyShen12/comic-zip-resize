const fsModule = require('fs')
const path = require('path')
const { inspect } = require('util')

const fs = fsModule.promises

const chalk = require('chalk')
const { v4: uuidV4 } = require('uuid')

const { closeAllPools } = require('./src/threads-helper')
const { TMP_PATH } = require('./src/config')
const { getZipTree } = require('./src/util')

const workingDir = process.argv[2]
const silenceMode = process.argv.includes('--silence')

/**
 * 1. Rezip bad file name encoding zip
 * 2. transform *.png, *.bmp, *.JPG, *.webm, *.webp to standard sharp.JPEG
 * 3. remove useless *.url, *.db, *.txt ...
 */
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

async function scanZipFile(filePath) {
  fileIndex++

  if (!silenceMode) console.log(`scan file: ${chalk.magentaBright(filePath)}`)

  const fileList = (await getZipTree(filePath)).getAllFiles()
  const fileExtDict = fileList
    .map((f) => path.parse(f).ext)
    .reduce((p, c) => {
      if (!p[c]) p[c] = 1
      else p[c] = p[c] + 1
      return p
    }, {})
  const fileExtList = Object.keys(fileExtDict)
  if (fileExtList.length > 1 || fileExtList[0] !== '.jpg') {
    // console.log(
    //   `[${fileIndex}] ${filePath}.fileList length ${chalk.bold(fileList.length)}\nextensions: ${inspect(
    //     fileExtDict,
    //     false,
    //     Infinity,
    //     true
    //   )}`
    // )
  }

  // const fileBaseName = path.basename(filePath)
  // const filePathParsed = path.parse(filePath)

  // fileIndex++
  // const id = uuidV4()
  // const tempPath = path.resolve(TMP_PATH, id)
  // if (!fsModule.existsSync(tempPath)) await fs.mkdir(tempPath, { recursive: true })
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
