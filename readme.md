# Node.js RPC 集群（用于漫画 zip 包批量制作缩放版本副本）

## 启动

1. 更改 `config.js` 中的 `registryServer` 为你准备作为注册中心的机器
2. 启动注册中心 `npm run registry`
3. 启动计算服务 Provider `npm run server`
4. 启动主服务 `node index.js /path/to/your/comic_zip_files`

## 注意

- 在 node.js 版本小于 18 的机器上只能使用纯 JavaScript 版本的图像处理组件，效率会低约 10 倍
- 主服务内存占用巨大
