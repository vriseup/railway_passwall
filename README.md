# railway_passwall

Cloudflare Tunnel + WebSocket 回源镜像构建工程。

## 当前设计

- 运行时只保留 Cloudflare Tunnel 回源链路，入口程序不再监听 `3000`，不再提供 `/sub` HTTP 路由。
- 代理客户端使用 Cloudflare Tunnel 域名与 `443` 端口连接。
- 订阅内容由本地 `make.sh` 生成到项目根目录 `sub.txt`，该文件不会提交 GitHub，也不会打进镜像。

## 工作原理

- [`index.template.js`](index.template.js) 是程序源码模板。
- 按节点变化的变量来自本地 [`.env`](.env)：
  - `ARGO_DOMAIN`
  - `ARGO_AUTH`
  - `UUID`
  - `CFIP`
- [`make.sh`](make.sh) 会：
  1. 读取 `.env`（不会提交到 Git）
  2. 把四个变量注入模板，生成临时文件
  3. 使用 `javascript-obfuscator` 混淆生成运行时入口 [`index.js`](index.js)
  4. 写入镜像名文件 `.image.name`
  5. 生成项目根目录 `sub.txt`
  6. 自动 `git commit && git push`
- GitHub Actions 监听 `main` 分支，从 `.image.name` 读取域名作为镜像名，构建并推送到 GHCR。

## 新节点部署流程

1. 在 Cloudflare 创建 Tunnel，得到域名与密钥。
2. 修改本地 `.env`：

```env
ARGO_DOMAIN=your-domain.example.com
ARGO_AUTH=your_token_or_json
UUID=your-uuid
CFIP=your-preferred-cf-cname
```

3. 执行：

```bash
./make.sh
```

脚本会自动提交并推送。GitHub Actions 构建完成后，镜像地址为：

```text
ghcr.io/vriseup/your-domain.example.com:latest
```

同时还会生成带提交 SHA 的标签：

```text
ghcr.io/vriseup/your-domain.example.com:<commit-sha>
```

## 订阅文件

每次执行 `./make.sh` 后会在项目根目录生成：

```text
sub.txt
```

格式为：

1. vless 明文链接
2. vmess 明文链接
3. trojan 明文链接
4. 空一行
5. 上述三条链接整体 base64

`sub.txt` 已在 [`.gitignore`](.gitignore) 中，不会被提交、不会被推送到 GitHub、也不会进入 Docker 镜像。

## Cloudflare Tunnel 配置

保留一条 route 即可：

```text
your-domain.example.com -> http://localhost:8001
```

不需要配置 `3000`，不需要启用 Railway Public Domain。

## 安全说明

- `.env` 已在 [`.gitignore`](.gitignore) 中，永远不会提交。
- `sub.txt` 已在 [`.gitignore`](.gitignore) 中，永远不会提交。
- 混淆后的 `index.js` 中不包含域名、认证密钥、UUID、优选域名明文。
- 请不要把 Cloudflare Tunnel 密钥或订阅内容贴到 issue、日志或公开聊天中。
