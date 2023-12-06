const fsSync = require('fs')
const path = require('path')
const { promises: fs } = fsSync
const { promises: stream } = require('stream')

module.exports = {
  /**
   * @param {string} dir
   */
  async removeAllFiles(dir) {
    return Promise.all(
      (await fs.readdir(dir, { withFileTypes: true })).filter((subF) => subF.isFile()).map((subF) => fs.rm(path.resolve(dir, subF.name)))
    )
  },
  // $ mv /my/path/*/* /my/path  # 将所有 dir 下子目录中的所有内容移动到 dir 下
  // $ find /my/path/* -type d -empty -delete  # 删除 dir 的所有空子目录
  /**
   * @param {string} dir
   */
  async moveUpFilesAndDeleteEmptyFolders(dir) {
    if (!fsSync.existsSync(dir) || !(await fs.stat(dir)).isDirectory()) {
      throw new Error(`moveFilesAndDeleteEmptyFolders Path ${dir} does not exist or is not a directory`)
    }

    const subfolders = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)

    for (const subfolder of subfolders) {
      const fullSubfolderPath = path.join(dir, subfolder)

      const filesWithinSubfolder = await fs.readdir(fullSubfolderPath)
      for (const file of filesWithinSubfolder) {
        const oldPath = path.join(fullSubfolderPath, file)
        const newPath = path.join(dir, file)

        // Make sure not to overwrite existing files in the destination
        if (!fsSync.existsSync(newPath)) {
          await fs.rename(oldPath, newPath)
        }
      }

      // After moving all files, check if directory is empty then delete
      if ((await fs.readdir(fullSubfolderPath)).length === 0) {
        await fs.rm(fullSubfolderPath, { recursive: true, force: true })
      }
    }
  },
  /**
   * @param {fsSync.PathLike} oldPath
   * @param {fsSync.PathLike} newPath
   */
  async renameEx(oldPath, newPath) {
    try {
      await fs.rename(oldPath, newPath)
    } catch (error) {
      if (error.code === 'EXDEV') {
        // Indicates the error is 'cross-device link not permitted'
        await stream.pipeline(fsSync.createReadStream(oldPath), fsSync.createWriteStream(newPath))

        // Once the file is copied successfully, remove it from the oldPath
        await fs.unlink(oldPath)
      } else {
        throw error
      }
    }
  },
}
