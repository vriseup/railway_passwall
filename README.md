# railway_passwall

Cloudflare Tunnel + WebSocket 回源镜像构建工程。

## 工作原理

- [`index.template.js`](index.template.js) 是程序源码模板。
- 仅 `ARGO_DOMAIN` 与 `ARGO_AUTH` 两个变量按节点变化，值来自本地 [`.env`](.env)。
- [`make.sh`](make.sh) 会：
  1. 读取 `.env`（不会提交到 Git）
  2. 把两个变量注入模板，生成临时文件
  3. 使用 `javascript-obfuscator` 混淆生成运行时入口 [`index.js`](index.js)
  4. 写入镜像名文件 `.image.name`
  5. 自动 `git commit && git push`
- GitHub Actions 监听 `main` 分支，从 `.image.name` 读取域名作为镜像名，构建并推送到 GHCR。

## 新节点部署流程

1. 在 Cloudflare 创建 Tunnel，得到域名与密钥。
2. 修改本地 `.env`：

```env
ARGO_DOMAIN=your-domain.example.com
ARGO_AUTH=your_token_or_json
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

## 安全说明

- `.env` 已在 [`.gitignore`](.gitignore) 中，永远不会提交。
- 混淆后的 `index.js` 中不包含域名与认证密钥明文。
- 请不要把 Cloudflare Tunnel 密钥贴到 issue、日志或公开聊天中。

## 本地生成（不提交）

```bash
npm install --include=dev
node scripts/inject-env.js index.template.js index.generated.js "$ARGO_DOMAIN" "$ARGO_AUTH"
node scripts/obfuscate.js index.generated.js index.js
node --check index.js
```
