# Node.js RPC 集群（用于漫画 zip 包批量制作缩放版本副本）

1. 更改 `config.js` 中的 `registryServer` 为你准备作为注册中心的机器
2. 启动注册中心 `npm run registry`
3. 启动计算服务 Provider `npm run server`
4. 启动主服务 `node index.js /path/to/your/comic_zip_files`
