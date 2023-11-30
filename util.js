const chalk = require('chalk')

module.exports = {
  quit: function (msg = 'error & quit', code = 2) {
    console.log(chalk.redBright(msg))
    process.exit(code)
  },
  ResizeMachine: {
    Local: 1,
    Remote: 2,
  },
}
