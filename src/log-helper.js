const chalk = require('chalk')
const path = require('path')

module.exports = {
  logStartFileProcess(filePath, tempPath) {
    console.log(
      `process file: ${chalk.cyanBright(filePath)} -> ${chalk.whiteBright(
        tempPath
      )}`
    )
  },
  logBeforeResize(
    thisIndex,
    fileIndex,
    filePath,
    entry,
    isLocal,
    selectedPool
  ) {
    // console.log(
    //   `<${String(thisIndex).padStart(
    //     String(fileIndex).length,
    //     ' '
    //   )}> ${path.basename(filePath)}/${chalk.blueBright(
    //     entry.fileName
    //   )} dispatch to [${
    //     isLocal
    //       ? chalk.magentaBright('L ')
    //       : chalk.cyanBright('R' + selectedPool.remoteIndex)
    //   }]`
    // )
  },
  logWhileChangeServer(
    thisIndex,
    fileIndex,
    filePath,
    entry,
    isLocal,
    selectedPool,
    oldIsLocal,
    oldSelectedPool,
    retried,
    error
  ) {
    console.error(error)
    console.log(
      `<${String(thisIndex).padStart(
        String(fileIndex).length,
        ' '
      )}> ${path.basename(filePath)}/${chalk.blueBright(
        entry.fileName
      )} ${chalk.redBright('Re')}dispatch from [${
        oldIsLocal
          ? chalk.magentaBright('L ')
          : chalk.cyanBright('R' + oldSelectedPool.remoteIndex)
      }] --> [${
        isLocal
          ? chalk.magentaBright('L ')
          : chalk.cyanBright('R' + selectedPool.remoteIndex)
      }] (retried ${chalk.redBright(retried)})`
    )
  },
  logAfterResize(
    thisIndex,
    fileIndex,
    isLocal,
    selectedPool,
    processedEntry,
    entryCount,
    filePath,
    entry,
    cost,
    processSpeed
  ) {
    console.log(
      `<${String(thisIndex).padStart(String(fileIndex).length, ' ')}> [${
        isLocal
          ? chalk.magentaBright('L ')
          : chalk.cyanBright('R' + selectedPool.remoteIndex)
      }] ${chalk.greenBright('resizing file')} (${String(
        processedEntry
      ).padStart(3, ' ')}/${String(entryCount).padStart(
        3,
        ' '
      )}) ${path.basename(filePath)}/${chalk.blueBright(
        entry.fileName
      )} cost: ${chalk.yellowBright(
        cost.toFixed(3)
      )} sec, speed: ${chalk.redBright(processSpeed.toFixed(1))} K/s`
    )
  },
  logAfterSkipped(
    thisIndex,
    fileIndex,
    processedEntry,
    entryCount,
    filePath,
    entry
  ) {
    console.log(
      `<${String(thisIndex).padStart(
        String(fileIndex).length,
        ' '
      )}> ${chalk.greenBright('resizing file')} (${String(
        processedEntry
      ).padStart(3, ' ')}/${String(entryCount).padStart(
        3,
        ' '
      )}) ${path.basename(filePath)}/${chalk.blueBright(
        entry.fileName
      )} ${chalk.greenBright('size too small, skipped')}`
    )
  },
}
