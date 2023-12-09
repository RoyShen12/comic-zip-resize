const fs = require('fs')
const path = require('path')
const archiver = require('archiver')

const { quit } = require('./src/util')
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

dirs.forEach((dir) => {
  const dirPath = path.join(workingDir, dir)
  // 创建一个.archiver对象
  const archive = archiver('zip', {
    zlib: { level: 0 }, // 压缩级别
  })
  archive.on('warning', (err) => {
    if (err.code === 'ENOENT') {
      console.log(chalk.redBright('archive on warning: ENOENT'))
      console.error(err)
    } else {
      throw err
    }
  })
  archive.on('error', (err) => {
    console.log(chalk.redBright('archive on error'))
    console.error(err)
    throw err
  })

  const output = fs.createWriteStream(path.join(workingDir, dir + '.zip'), {
    highWaterMark: 1024 * 1024 * 16,
  })
  output.on('error', (err) => {
    console.log(chalk.redBright('archive on write stream error'))
    console.error(err)
    throw err
  })
  output.on('close', function () {
    console.log(archive.pointer() + ' total bytes')
    console.log(`archiver has been finalized and the output file descriptor has closed.`)

    // 删除源目录
    fs.rmSync(dirPath, { recursive: true })
  })

  archive.pipe(output)
  archive.directory(dirPath, false)
  archive.finalize()
})
