const fs = require('fs')
const path = require('path')

const { quit, zipDirectory } = require('./src/util')
const chalk = require('chalk')

const workingDir = process.argv[2]

if (!workingDir) {
  quit('working dir is empty')
}

// 在当前目录获取子目录
const dirs = fs
  .readdirSync(workingDir, { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .map((dirent) => dirent.name)

;(async () => {
  await Promise.all(
    dirs.map(async (dir) => {
      const dirPath = path.join(workingDir, dir)
      // check dir inside is all file
      if ((await fs.promises.readdir(dirPath, { withFileTypes: true })).some((fd) => !fd.isFile())) {
        return console.error(chalk.redBright(`some in ${dirPath} is not file!`))
      }

      await zipDirectory(
        dirPath,
        fs.createWriteStream(path.join(workingDir, dir + '.zip'), {
          highWaterMark: 1024 * 1024 * 16,
        }),
        undefined,
        async (pointer) => {
          console.log((pointer / 1024 / 1024).toFixed(1) + ' total M bytes')
          await fs.promises.rm(dirPath, { recursive: true })
        }
      )
    })
  )
})()
