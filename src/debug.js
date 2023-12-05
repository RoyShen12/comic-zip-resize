module.exports = {
  timeProbe(name = '', precision = 1) {
    const s = process.hrtime.bigint()
    return () => {
      console.log(`${name} cost ${(Number(process.hrtime.bigint() - s) / 1e6).toFixed(precision)}ms`)
    }
  },
}
