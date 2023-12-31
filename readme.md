# 分布式 Node.js RPC 集群（用于对漫画 zip 包批量制作低分辨率版本的副本）

## 如何启动本玩具

1. 更改 `config.js` 中的 `registryServer` 为你准备作为注册中心的机器
2. 启动注册中心 `npm run registry`
3. 启动计算服务 Provider `npm run server`
4. 启动主服务 `node index.js /path/to/your/comic_zip_files`
5. 主服务会遍历目录下的所以 zip 文件、解压、交给计算服务将每张图像缩小 `config.js SHARP_RATIO`倍，重新压缩并写入原压缩文件目录，添加 (LowQuality) 文件名

## 注意

- 在 node.js 版本小于 18 的机器上只能使用纯 JavaScript 版本的图像处理组件 `Jimp`，效率会低约 10 倍
- 主服务内存占用巨大
- `config.js` 中的 `localThread` 改为 `0` 可以放弃本地计算
- `config.js` 中的 `SHARP_MIN_SIZE` 可以过滤小尺寸的图片不参与压缩
- 在主服务工作时能启动新的计算服务并动态分配负载
- 能容忍计算服务挂掉
- 使用 `RPC_LOG=1 node xxx...` 启动服务来打印所有 rpc 请求明细
