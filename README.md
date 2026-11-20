# railway_passwall

用于 Railway 等 serverless / PaaS 平台的 Cloudflare Tunnel WebSocket 回源服务。

本项目采用最纯粹的部署方式：

- 仓库中保留混淆后的通用 [`index.js`](index.js)；
- `index.js` 不包含任何真实域名、Tunnel 密钥、UUID 或优选地址；
- 运行时所有配置都从 `process.env` 读取；
- 一套 GitHub 仓库可以在 Railway 上创建多个 Service，每个 Service 使用不同 Variables，实现多个域名和 Tunnel 并行部署。

## 单出口与 Railway 兼容性

- 不配置 `IPS` / `PORTS`，或设置为空值：单出口环境使用系统默认出口，入口默认 `8001`。不要求容器拥有宿主机网络权限。
- 只配置 `PORTS=8101`：入口改为 `8101`，Cloudflare Route 也需同步指向该端口。
- 配置一个 `IPS`：该地址必须是容器当前网络命名空间内的真实本地 IPv4；绑定宿主机地址仍需 Linux host 网络。不要填写容器不可见的宿主 NAT 地址或公网映射地址。
- 未显式指定 IP 时，只有发现多个符合筛选规则的 IPv4 才自动分别绑定；找不到候选地址或只有一个候选地址时使用默认路由，不因 PaaS 私网地址被过滤而启动失败。
- Railway 继续使用根目录 Dockerfile 构建，不执行 Docker Compose，也不要求 host 网络。仅配置 `DOMAIN` / `AUTH` 或 `ARGO_DOMAIN` / `ARGO_AUTH` 即可；多出口模式无需关闭。
- 仓库 Compose 的 `network_mode: host` 面向需要绑定宿主多 IP 的 Linux 主机；普通单出口 bridge 容器可以移除此行。它不影响 Railway 的 Dockerfile 构建。

配置回归测试（不启动 Tunnel、不访问网络、不读取真实密钥）：

```bash
node scripts/test-config.js
```

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

本项目已移除 `3000` 端口 HTTP 服务、`/sub` HTTP 路由和本地 `sub.txt` 生成脚本。

## 订阅内容

服务启动并成功连接 Cloudflare Tunnel 后，Railway 的 Deploy Logs 会自动打印一整段 base64 内容。

该 base64 解码后包含三条完整协议链接：

```text
vless://...
vmess://...
trojan://...
```

节点别名格式默认如下：

```text
域名-vless
域名-vmess
域名-trojan
```

如果设置了 `NAME` 变量，则别名格式变为：

```text
NAME-vless
NAME-vmess
NAME-trojan
```

你只需要复制 Deploy Logs 中的 base64 内容即可，不需要手动拼接三协议链接。

多出口模式下，Deploy Logs 会按 `DOMAINS` / 自动枚举 IP 的数量，分别打印多套订阅内容，每套对应一个域名和一个出口 IP，例如：

```text
===== SUBSCRIPTION 1/3 th1-argo.example.com -> 172.18.30.33 -> localhost:8001 =====
<第一套 base64>

===== SUBSCRIPTION 2/3 th2-argo.example.com -> 172.18.30.34 -> localhost:8002 =====
<第二套 base64>

===== SUBSCRIPTION 3/3 th3-argo.example.com -> 172.18.30.35 -> localhost:8003 =====
<第三套 base64>
```

每套 base64 解码后仍然包含 vless / vmess / trojan 三条协议链接，只是 `host`、`sni` 和节点名称使用对应域名。

## 多出口 IPv4 / 多域名模式（默认启用）

项目默认启用多出口模式。可通过 `.env` 中的 `DOMAINS`、`PORTS`、`IPS` 控制“域名 → 本地端口 → 出口 IP”映射；若 `IPS` 为空，则自动枚举当前网络命名空间中可见的有效 IPv4。

### 推荐 .env 示例

```env
DOMAINS=th1-argo.586658.xyz,th2-argo.586658.xyz,th3-argo.586658.xyz
IPS=
PORTS=8001,8002,8003
AUTH=eyJhIjoi...你的Cloudflare Tunnel Token...
```

对应关系：

```text
th1-argo.586658.xyz -> localhost:8001 -> IPS[1] 或自动枚举 IP[1]
th2-argo.586658.xyz -> localhost:8002 -> IPS[2] 或自动枚举 IP[2]
th3-argo.586658.xyz -> localhost:8003 -> IPS[3] 或自动枚举 IP[3]
```

Cloudflare Tunnel Routes 需要按图例手动/自动配置到这些 `localhost:800x` 端口。

### IPS 为空：自动枚举模式

当：

```env
IPS=
```

或未配置 `IPS` 时，程序会枚举当前容器可见网卡 IPv4。若使用 Docker host 网络，枚举到的就是宿主网卡。

适合：

- 云厂商直接分配多个公网 IPv4；
- 阿里云轻量云等多网卡/多别名 IP；
- 希望容器直接使用宿主网络，不做端口映射。

此模式建议：

```yaml
network_mode: host
```

并注意 host 模式下不要依赖 `ports` 端口映射。

自动枚举会优先排除 `docker0`、`br-*`、Tailscale、veth、tun/tap、wireguard、loopback 等虚拟网卡。默认也排除私有 IPv4；腾讯云轻量这种只有 `10.10.x.x` 内网 NAT + 公网出口的场景，如确实需要把它作为 `sendThrough`，需设置：

```env
MULTI_IP_INCLUDE_PRIVATE=true
```

### IPS 非空：显式 IP 模式

当：

```env
IPS=172.18.30.33,172.18.30.34,172.18.30.35
```

程序只使用这里列出的 IP，不再自动枚举。

适合：

- 你已经明确知道每张网卡/别名 IP；
- 宿主机有多张内网 NAT IPv4，但 Cloudflare / 云厂商 NAT 会把它们分别映射为不同公网出口；
- 自动枚举结果需要通过显式列表固定顺序。

**显式填写 IPS 仍然需要 host 网络。** `sendThrough` 是 outbound 对象的顶层字段（与 `protocol`、`settings` 同级），只能绑定当前网络命名空间内的本地地址。普通 bridge 容器没有宿主网卡地址；端口映射只控制入站，不能让出站绑定宿主 IP。

```yaml
network_mode: host
```

Cloudflare Tunnel 与 Xray 在同一网络命名空间，Routes 仍指向 `localhost:8001/8002/8003`，不需要端口映射。host 模式需提前检查监听端口冲突，不应通过 bridge + 宿主 IPS 的方式绕过。

### 端口与域名

变量按位置一一对应：

```text
DOMAINS[0] -> PORTS[0] -> IPS[0]
DOMAINS[1] -> PORTS[1] -> IPS[1]
DOMAINS[2] -> PORTS[2] -> IPS[2]
```

若 `PORTS` 为空，默认从 `PORT` / `ARGO_PORT` 或 `8001` 开始，每组间隔 `10`。

若 `DOMAINS` 为空，旧变量 `DOMAIN` / `ARGO_DOMAIN` 仍兼容；多出口时会退化为 `net1`、`net2` 等占位域名，通常不建议。

### 兼容变量

仍支持旧写法：

```env
DOMAIN=
ARGO_DOMAIN=
ARGO_AUTH=
```

也支持新写法：

```env
DOMAINS=
PORTS=
IPS=
AUTH=
```

优先级：

```text
AUTH / ARGO_AUTH
DOMAINS / DOMAIN / ARGO_DOMAIN
PORTS / ARGO_PORTS / ARGO_PORT
IPS / MULTI_IP_IPS
```

## 多出口 IPv4 / 多网卡模式（旧版自动枚举说明）

本项目支持在 Docker `host` 网络下，根据容器可见的宿主 IPv4 地址自动生成多组 xray 入站、出站与路由规则：

- 第 1 个有效 IPv4：入站主端口 `8001`，组内端口 `8001-8005`
- 第 2 个有效 IPv4：入站主端口 `8011`，组内端口 `8011-8015`
- 第 3 个有效 IPv4：入站主端口 `8021`，组内端口 `8021-8025`
- 依此类推，每组间隔 `10`

每个 `freedom` outbound 会设置对应 IP 的 `sendThrough`，并通过 `routing.rules` 将该组入站绑定到该出口。

### 启用方式

必须让容器使用宿主网络，例如 [`docker-compose.yml`](docker-compose.yml) 中：

```yaml
network_mode: host
```

然后在环境变量中启用：

```env
MULTI_IP_MODE=true
```

如果使用 JSON 型 `ARGO_AUTH` 和固定 `ARGO_DOMAIN`，`ARGO_DOMAIN` 可以写成逗号分隔的域名列表，程序会依次生成 tunnel ingress：

```env
ARGO_DOMAIN=net1.example.com,net2.example.com,net3.example.com
```

对应 Cloudflare Tunnel Route / ingress 应按顺序指向：

```text
net1.example.com -> http://localhost:8001
net2.example.com -> http://localhost:8011
net3.example.com -> http://localhost:8021
```

如果使用 token 型 `ARGO_AUTH`，需要在 Cloudflare 控制台中手动创建上述 Route。

### 有效 IPv4 选择规则

程序默认只纳入宿主网络下常见物理网卡前缀：

```text
eth, ens, enp, eno, em, bond, br, wan, lan
```

默认排除常见虚拟网卡关键词：

```text
docker, br-, veth, virbr, vmbr, tailscale, ts, tun, tap, ppp, lo, cni, flannel, cali, weave, macvlan, ipvlan, site, utun, wg, wireguard
```

默认不纳入私有 IPv4，避免误把云厂商 NAT 内网地址、Docker 网络、局域网地址当成公网出口。如需把内网 NAT 地址也作为出口，可设置：

```env
MULTI_IP_INCLUDE_PRIVATE=true
```

如需手动覆盖枚举结果，可直接指定 IP 列表：

```env
MULTI_IP_IPS=1.2.3.4,5.6.7.8
```

也可通过更多环境变量调整筛选项：

```env
MULTI_IP_INCLUDE_LOOPBACK=false
MULTI_IP_IFACE_PREFIXES=eth,ens,enp,eno,em,bond,br,wan,lan
MULTI_IP_IFACE_EXCLUDE=docker,br-,veth,virbr,vmbr,tailscale,ts,tun,tap,ppp,lo,cni,flannel,cali,weave,macvlan,ipvlan,site,utun,wg,wireguard
```

### 重要限制

- `host` 网络下不要依赖 `ports` 端口映射。
- 多出口模式依赖容器内能看到宿主网卡地址；bridge 网络通常看不到宿主多 IP。
- 云厂商直接分配公网 IPv4 时，通常可自动枚举；只分配内网 NAT 地址时，需要设置 `MULTI_IP_INCLUDE_PRIVATE=true`。
- 该模式不能直接从 HTTP Host / SNI 自动选择出口；它通过“不同域名路由到不同本地端口”来实现按域名选择出口。

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
