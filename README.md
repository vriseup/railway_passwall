# railway_passwall

用于 Railway 等 serverless / PaaS 平台的 Cloudflare Tunnel WebSocket 回源服务。

本项目采用最纯粹的部署方式：

- 仓库中保留混淆后的通用 [`index.js`](index.js)；
- `index.js` 不包含任何真实域名、Tunnel 密钥、UUID 或优选地址；
- 运行时所有配置都从 `process.env` 读取；
- 一套 GitHub 仓库可以在 Railway 上创建多个 Service，每个 Service 使用不同 Variables，实现多个域名和 Tunnel 并行部署。

## 部署到 Railway

### 1. 连接 GitHub 仓库

在 Railway 中创建新 Service，选择连接 GitHub 仓库：

```text
vriseup/railway_passwall
```

Railway 会自动检测 `package.json` 并以 Node.js 方式部署。

入口命令为：

```bash
npm run start
```

等价于：

```bash
node index.js
```

### 2. 配置 Service Variables

进入 Railway 服务的：

```text
Variables → Service Variables → Raw Editor
```

添加以下变量。

#### 通常只需要配置这两项

标准变量名：

```env
ARGO_DOMAIN=railway001.586658.xyz
ARGO_AUTH=eyJhIjoi...你的Cloudflare Tunnel Token...
```

也可以使用简写变量名：

```env
DOMAIN=railway001.586658.xyz
AUTH=eyJhIjoi...你的Cloudflare Tunnel Token...
```

规则：`ARGO_DOMAIN` / `ARGO_AUTH` 优先；如果未提供，则读取 `DOMAIN` / `AUTH`。

只要 Cloudflare Tunnel 的 route 已经配置好，`UUID` 和 `CFIP` 可以使用项目内置默认值，不需要每次填写。

#### 可选覆盖变量

```env
UUID=aae820aa-a042-4938-9fc5-fe1d2b492c1c
CFIP=cdns.doon.eu.org
```

#### 变量说明

| 变量 | 是否必填 | 示例 | 说明 |
|---|---:|---|---|
| `ARGO_DOMAIN` | 二选一 | `railway001.586658.xyz` | Cloudflare Tunnel 绑定的固定域名；标准变量名 |
| `ARGO_AUTH` | 二选一 | Token 或 JSON | Cloudflare Tunnel 密钥；标准变量名 |
| `DOMAIN` | 二选一 | `railway001.586658.xyz` | `ARGO_DOMAIN` 的简写 |
| `AUTH` | 二选一 | Token 或 JSON | `ARGO_AUTH` 的简写 |
| `UUID` | 否 | `aae820aa-a042-4938-9fc5-fe1d2b492c1c` | 节点 UUID；不填时使用项目内置默认值 |
| `CFIP` | 否 | `cdns.doon.eu.org` | Cloudflare 亚洲优选 IP / CNAME 域名；不填时使用项目内置默认值 |

#### 可选变量

```env
ARGO_PORT=8001
CFPORT=443
NAME=railway001
FILE_PATH=.tmp
```

| 变量 | 默认值 | 说明 |
|---|---:|---|
| `ARGO_PORT` | `8001` | 容器内 xray 入站端口，Cloudflare Tunnel route 应指向它 |
| `CFPORT` | `443` | 客户端连接优选地址使用的端口 |
| `NAME` | 空 | 节点名称前缀；为空时程序会自动获取 ISP 信息 |
| `FILE_PATH` | `.tmp` | 容器内临时文件目录 |

### 3. Cloudflare Tunnel 配置

在 Cloudflare Zero Trust / Tunnels / Routes 中配置：

```text
Hostname: railway001.586658.xyz
Service: HTTP
URL: localhost:8001
```

不需要配置 `3000` 端口。

不需要启用 Railway Public Domain。

Cloudflare Tunnel 只需要回源到容器内的 `8001`。

## 多域名 / 多 Tunnel 并行部署

同一份 GitHub 仓库可以创建多个 Railway Service。

例如：

### Service A

```env
ARGO_DOMAIN=a.example.com
ARGO_AUTH=token-a
UUID=aae820aa-a042-4938-9fc5-fe1d2b492c1c
CFIP=cdns.doon.eu.org
```

### Service B

```env
ARGO_DOMAIN=b.example.com
ARGO_AUTH=token-b
UUID=bae820aa-a042-4938-9fc5-fe1d2b492c1c
CFIP=cdn-b.example.com
```

每个 Service 独立构建、独立运行、独立变量。

Railway 连接 GitHub 后，代码变动会触发所有关联 Service 重新部署；这没问题，因为所有配置都在各自 Service 的 Variables 中，不在代码里。

## 端口说明

容器内只需要关注一个端口：

```text
8001
```

用途：

- xray vless / vmess / trojan inbound；
- Cloudflare Tunnel route 回源目标；
- 客户端 WebSocket 路径：
  - `/vless-argo?ed=2560`
  - `/vmess-argo?ed=2560`
  - `/trojan-argo?ed=2560`

本项目已移除 `3000` 端口 HTTP 服务、`/sub` HTTP 路由和本地 `sub.txt` 生成脚本。订阅链接请自行根据域名、UUID、CFIP 拼接。

## 订阅链接拼接模板

替换下面模板中的：

- `YOUR_UUID`
- `YOUR_CFIP`
- `YOUR_DOMAIN`
- `YOUR_NAME`

即可手动生成订阅内容。

### vless

```text
vless://YOUR_UUID@YOUR_CFIP:443?encryption=none&security=tls&sni=YOUR_DOMAIN&fp=chrome&alpn=http%2F1.1&type=ws&host=YOUR_DOMAIN&path=%2Fvless-argo%3Fed%3D2560#YOUR_NAME-vless
```

### vmess

```text
vmess://BASE64_JSON
```

其中 `BASE64_JSON` 是下面 JSON 的 base64：

```json
{
  "v": "2",
  "ps": "YOUR_NAME-vmess",
  "add": "YOUR_CFIP",
  "port": "443",
  "id": "YOUR_UUID",
  "aid": "0",
  "scy": "none",
  "net": "ws",
  "type": "none",
  "host": "YOUR_DOMAIN",
  "path": "/vmess-argo?ed=2560",
  "tls": "tls",
  "sni": "YOUR_DOMAIN",
  "alpn": "http/1.1",
  "fp": "chrome",
  "insecure": "0",
  "pcs": ""
}
```

### trojan

```text
trojan://YOUR_UUID@YOUR_CFIP:443?security=tls&sni=YOUR_DOMAIN&fp=chrome&alpn=http%2F1.1&type=ws&host=YOUR_DOMAIN&path=%2Ftrojan-argo%3Fed%3D2560#YOUR_NAME-trojan
```

## 安全说明

- 不要把 `ARGO_AUTH` 提交到 GitHub。
- 不要创建包含真实密钥的 `.env` 并提交。
- 密钥只应放在 Railway Service Variables 或 Cloudflare 控制台中。
- 仓库内的 `index.js` 是通用混淆版本，不写入真实配置。

## 本地重新生成混淆入口

如果修改了 [`index.template.js`](index.template.js)，可重新生成 [`index.js`](index.js)：

```bash
npm install --include=dev
npm run build
node --check index.js
```

`npm run build` 只做一件事：

```bash
node scripts/obfuscate.js index.template.js index.js
```

它不会注入任何变量，也不会读取 `.env`。
