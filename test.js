/* eslint-disable no-magic-numbers */
const fs = require('fs')
const crypto = require('crypto')
const path = require('path')

// 中文字符的Unicode范围
const minCharCode = 0x4e00
const maxCharCode = 0x9fff

// 字母列表用于文件后缀
const letters = 'abcdefghijklmnopqrstuvwxyz'

// 生成随机字节
function getRandomBytes(size) {
  return crypto.randomBytes(size)
}

function getRandomChineseString(fileNameSize) {
  let ret = ''
  for (let i = 0; i < fileNameSize; i++) {
    const unicodeNum = Math.floor(Math.random() * (maxCharCode - minCharCode + 1)) + minCharCode
    ret += String.fromCharCode(unicodeNum)
  }
  return ret
}

function getRandomEnglishString(suffixSize) {
  let ret = ''
  for (let i = 0; i < suffixSize; i++) {
    ret += letters.charAt(Math.floor(Math.random() * letters.length))
  }
  return ret
}

// 生成随机文件名
function getRandomFileName() {
  const fileNameSize = Math.floor(Math.random() * 9) + 4 // 4-12
  const prefix = getRandomChineseString(fileNameSize)

  const suffixSize = Math.floor(Math.random() * 3) + 2 // 2-4
  let suffix = getRandomEnglishString(suffixSize)

  return prefix + '.' + suffix
}

async function createFiles(directory, chapterNumber, fileNumber, sizeRange) {
  let [minSize, maxSize] = sizeRange.split('-').map(Number)

  // 文件大小范围从字节转换为MB
  minSize *= 1024 * 1024
  maxSize *= 1024 * 1024

  await Promise.all([
    fs.promises.mkdir(path.join(directory, 'original'), { recursive: true }),
    fs.promises.mkdir(path.join(directory, 'waifu2x'), { recursive: true }),
  ])

  const chapters = new Array(chapterNumber).fill(1).map(() => getRandomChineseString(Math.floor(Math.random() * 9) + 4))

  await Promise.all(
    chapters.map(async (chapter) => {
      const path1 = path.join(directory, 'original', chapter)
      const path2 = path.join(directory, 'waifu2x', chapter)
      await Promise.all([fs.promises.mkdir(path1), fs.promises.mkdir(path2)])

      await Promise.all(
        new Array(fileNumber).fill(1).map(() => {
          const fn = getRandomFileName()
          return Promise.all([
            fs.promises.writeFile(
              path.join(directory, 'original', chapter, fn),
              getRandomBytes(Math.floor(Math.random() * (maxSize - minSize + 1) + minSize))
            ),
            fs.promises.writeFile(
              path.join(directory, 'waifu2x', chapter, fn),
              getRandomBytes(Math.floor(Math.random() * (maxSize - minSize + 1) + minSize))
            ),
          ])
        })
      )
    })
  )
}

// 接收命令行参数
const directory = process.argv[2]
const chapters = process.argv[3]
const files = process.argv[4]
const sizeRange = process.argv[5]

createFiles(directory, Number(chapters), Number(files), sizeRange).then(() => console.log('finish'))
