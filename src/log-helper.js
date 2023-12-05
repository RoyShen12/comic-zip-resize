const chalk = require('chalk')
const path = require('path')

module.exports = {
  logStartFileProcess(filePath, tempPath) {
    console.log(`process file: ${chalk.cyanBright(filePath)} -> ${chalk.whiteBright(tempPath)}`)
  },
  logBeforeResize(thisIndex, fileIndex, filePath, entry, isLocal, selectedPool) {
    console.log(
      `<${String(thisIndex).padStart(String(fileIndex).length, ' ')}> ${path.basename(filePath)}/${chalk.blueBright(
        entry.fileName
      )} dispatch to [${isLocal ? chalk.magentaBright('L ') : chalk.cyanBright('R' + selectedPool.remoteIndex)}]`
    )
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
      `<${String(thisIndex).padStart(String(fileIndex).length, ' ')}> ${path.basename(filePath)}/${chalk.blueBright(
        entry.fileName
      )} ${chalk.redBright('Re')}dispatch from [${
        oldIsLocal ? chalk.magentaBright('L ') : chalk.cyanBright('R' + oldSelectedPool.remoteIndex)
      }] --> [${
        isLocal ? chalk.magentaBright('L ') : chalk.cyanBright('R' + selectedPool.remoteIndex)
      }] (retried ${chalk.redBright(retried)})`
    )
  },
  logAfterResize(
    thisIndex,
    fileIndex,
    isLocal,
    selectedPool,
    processedEntry,
    skippedEntries,
    fileStart,
    entryCount,
    filePath,
    entry,
    cost,
    processSpeed,
    threadId
  ) {
    let speedUnit = 'K/s'
    if (processSpeed > 1024) {
      processSpeed = processSpeed / 1024
      speedUnit = 'M/s'
    }
    const speed = `${chalk.redBright(processSpeed.toFixed(1))} ${speedUnit}`
    const timeCost = `cost: ${chalk.yellowBright(cost.toFixed(2))} sec`
    const fileSpeed = `${((processedEntry - skippedEntries) / (Number(process.hrtime.bigint() - fileStart) / 1e9)).toFixed(1)}/s`
    console.log(
      `<${String(thisIndex).padStart(String(fileIndex).length, ' ')}> (${fileSpeed}) [${
        isLocal ? chalk.magentaBright('L ') : chalk.cyanBright('R' + selectedPool.remoteIndex)
      }][${chalk.magentaBright(threadId)}] ${chalk.greenBright('resizing file')} (${String(processedEntry).padStart(
        3,
        ' '
      )}/${String(entryCount).padStart(3, ' ')}) ${path.basename(filePath)}/${chalk.blueBright(
        entry.fileName
      )} ${timeCost}, speed: ${speed}`
    )
  },
  logAfterSkipped(thisIndex, fileIndex, processedEntry, entryCount, filePath, entry) {
    console.log(
      `<${String(thisIndex).padStart(String(fileIndex).length, ' ')}> ${chalk.greenBright('resizing file')} (${String(
        processedEntry
      ).padStart(3, ' ')}/${String(entryCount).padStart(3, ' ')}) ${path.basename(filePath)}/${chalk.blueBright(
        entry.fileName
      )} ${chalk.greenBright('size too small, skipped')}`
    )
  },
}
