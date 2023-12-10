const os = require('os')
const path = require('path')

function isNodeLargerThan16() {
  return Number(process.versions.node.split('.')[0]) > 16
}

// jimp 单实例内存限制
const JPEG_MAX_MEM = 1536

module.exports = {
  // 临时目录
  TMP_PATH: os.platform() === 'darwin' ? path.resolve(os.homedir(), 'temp/image') : path.resolve(os.homedir(), 'bin/temp/image'),

  // 只处理尺寸大于此的图片
  SHARP_MIN_SIZE: 1 * 1024, // 单位 KByte
  // 图片缩小比例
  SHARP_RATIO: 0.5,
  SHARP_FILE_NAME_SUFFIX: '(LowQuality)',
  // 缩放最大尝试次数
  MAX_RETRY: 5,

  // rpc
  RPC_MAX_RETRY: 3,
  RPC_TIMEOUT: 15000,

  JPEG_MAX_MEM,

  // 注册中心地址，唯一需要配置的 ip 端口
  registryServer: {
    ip: '192.168.50.59',
    port: 4004,
  },

  zipThread: os.cpus().length,
  localThread: isNodeLargerThan16()
    ? /**sharp */ os.platform() === 'win32'
      ? Math.max(2, Math.round(os.cpus().length / 2) + 1)
      : os.platform() === 'darwin'
        ? Math.max(2, Math.round(os.cpus().length / 2))
        : Math.max(2, Math.round(os.cpus().length / 2) - 1)
    : /** jimp */ Math.max(1, os.cpus().length - 3),
  serverWorkerThread() {
    if (isNodeLargerThan16()) {
      // sharp
      return Math.max(2, Math.round(os.cpus().length / 2) + 1)
    } else {
      // jimp
      const memCapacity =
        Math.floor((os.freemem() / (JPEG_MAX_MEM * 1024 * 1024)) * (os.platform() === 'darwin' ? 1.5 : 1)) -
        (os.platform() === 'linux' ? 1 : 0)
      return Math.min(os.cpus().length - 1, memCapacity - 1)
    }
  },
  // localThread: 0,

  // 注册中心拉取配置间隔
  REMOTE_CONFIG_REFRESH: 1000,
  // 注册中心请求超时
  REMOTE_CONFIG_TIMEOUT: 300,
  // 注册超时
  REGISTRY_TIMEOUT: 600,
  // 心跳检查超时
  ALIVE_TIMEOUT: 600,
  // 心跳检查间隔
  ALIVE_INTERVAL: 2000,

  // one shot check
  oneShotSuffix: [' - 第1集', ' - 第1話', ' - 熟肉', ' - 生肉', ' - 正文'],
  /**
   * @param {string} name
   */
  oneShotFileNameAfterProcessor(name) {
    const trash = [
      '[CE家族社]',
      '（落莲汉化组）',
      '（个人渣翻）',
      '[汉化]',
      '[漢化]',
      '[萌姬天堂]',
      '[中文]',
      '[无毒修图组]',
      '[无毒气X光年]',
      '[无毒漢化组]',
      '[背徳漢 (背徳漢)]',
      '[52H里漫画组]',
      '[RHC80小组]',
      '[CE×无毒联合汉化]',
      '[Aeroblast 个人汉化]',
      /【CE[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\w]+】/gu,
      /^\[[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}☆★\w]+个人汉化\]/gu,
      /^\([\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}☆★\w]+个人汉化\)/gu,
      /^（[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}☆★\w]+个人汉化）/gu,
      /^\[[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}☆★\w]+個人漢化\]/gu,
      /^\[[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}☆★\w]+汉化组?\]/gu,
      /^\[[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}☆★\w]+漢化組?\]/gu,
      /^\[[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}☆★\w]+掃圖\]/gu,
      /^\[[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}☆★&\w]+联合汉化组?\]/gu,
      /^\[[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}☆★&\w]+合作汉化组?\]/gu,
      /^【[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}☆★\w]+汉化组?】/gu,
      /^【[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}☆★\w]+漢化組?】/gu,
      /^个人汉化/,
      '(流星个人汉化)',
      '(E个人汉化）',
      '[朔夜汉化013]',
      '[无毒X樱丘]',
      /^012/,
      /^013/,
      /^\(成年コミック\)/,
    ]
    let removedItems = []
    const batchAfter = trash.reduce(
      /**
       * @param {string} prev
       * @param {string | RegExp} current
       * @returns
       */
      (prev, current) => {
        let after = prev

        if (typeof current === 'string') {
          while (after.includes(current)) {
            after = after.replace(current, '')
            removedItems.push(current)
          }
        } else if (current instanceof RegExp) {
          let match
          while ((match = current.exec(after)) !== null) {
            after = after.replace(match[0], '')
            removedItems.push(match[0])
          }
        }

        return after
      },
      name.normalize('NFC')
    )

    const result = batchAfter + removedItems.join('')
    // console.log(`before ${name}\nafter  ${result}`)
    return result.replace(/^\s+/, '').replace(/\s+$/, '').normalize('NFC')
  },

  isNodeLargerThan16,
}
