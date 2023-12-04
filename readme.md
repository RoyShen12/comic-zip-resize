# Node.js RPC 集群（用于漫画 zip 包批量制作低分辨率版本副本）

## 启动

1. 更改 `config.js` 中的 `registryServer` 为你准备作为注册中心的机器
2. 启动注册中心 `npm run registry`
3. 启动计算服务 Provider `npm run server`
4. 启动主服务 `node index.js /path/to/your/comic_zip_files`
5. 主服务会遍历目录下的所以 zip 文件、解压、交给计算服务将每张图像缩小 `config.js SHARP_RATIO`X，重新压缩并写入原压缩文件目录，添加 (LowQuality) 文件名

## 注意

- 在 node.js 版本小于 18 的机器上只能使用纯 JavaScript 版本的图像处理组件，效率会低约 10 倍
- 主服务内存占用巨大
- `config.js` 中的 `localThread` 改为 0 可以放弃本地计算
- 在主服务工作时能启动新的计算服务并动态分配负载
- 能容忍计算服务挂掉
