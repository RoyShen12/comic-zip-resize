const fs = require('fs')
const path = require('path')

const { quit, zipDirectory } = require('./src/util')
const chalk = require('chalk')

const workingDir = process.argv[2]

if (!workingDir) {
  quit('working dir is empty')
}

// 在当前目录获取子目录
const subDirs = fs
  .readdirSync(workingDir, { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .map((dirent) => dirent.name)

;(async () => {
  await Promise.all(
    subDirs.map(async (subDir) => {
      const subDirPath = path.join(workingDir, subDir)
      // check dir inside is all file
      if ((await fs.promises.readdir(subDirPath, { withFileTypes: true })).some((fd) => !fd.isFile())) {
        return console.error(chalk.redBright(`some in ${subDirPath} is not file!`))
      }

      await zipDirectory(
        subDirPath,
        fs.createWriteStream(path.join(workingDir, subDir + '.zip'), {
          highWaterMark: 1024 * 1024 * 16,
        }),
        undefined,
        async (pointer) => {
          console.log((pointer / 1024 / 1024).toFixed(1) + ' total M bytes')
          await fs.promises.rm(subDirPath, { recursive: true })
        }
      )
    })
  )
})()
