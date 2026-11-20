# railway_passwall

通过 Cloudflare Tunnel 提供 WebSocket 代理回源，支持 Railway 单出口部署和 Linux 主机多 IPv4 出口绑定。同一个 Tunnel 可以配置多个域名，分别回源到不同端口，无需为每个出口创建 Tunnel。

## 1. 准备环境变量

### 单出口（含 Railway）

```env
DOMAINS=node.example.com
AUTH=你的_Cloudflare_Tunnel_Token
```

Linux 主机可复制 [单出口示例](.env.single-ip.sample) 为 [本地环境文件](.env)，再填写真实值：

```bash
cp .env.single-ip.sample .env
```

不配置 `IPS`、`PORTS` 或留空即可：使用系统默认出口，主入口默认 `8001`。不需要关闭多出口模式。

### 多出口 Linux 主机

```env
DOMAINS=net1.example.com,net2.example.com,net3.example.com
IPS=172.18.30.33,172.18.30.34,172.18.30.35
PORTS=8001,8002,8003
AUTH=你的_Cloudflare_Tunnel_Token
```

也可复制 [多出口示例](.env.multi-ip.sample)：

```bash
cp .env.multi-ip.sample .env
```

域名、端口、源 IP 按顺序对应。`IPS` 必须是宿主机实际拥有的 IPv4；云厂商通过 NAT 映射公网时，填写本地网卡上的内网地址，不填仅存在于云端映射的公网地址。

### 选择规则

- 显式配置 `IPS`：只使用这些本地地址，逐一绑定出口；地址不可见时报错，不静默回退。
- `IPS` 未配置或为空：筛选当前网络命名空间可见 IPv4，排除 Docker、Tailscale、veth、tun/tap 等常见虚拟接口。
- 自动筛选结果为零个或一个地址：使用一个默认出口；配置多个端口时只取第一个。
- 自动筛选出多个地址：按筛选顺序分配出口。需要固定域名与 IP 的对应关系时，推荐显式填写 `IPS`。
- 自动筛选默认排除私网地址；云主机需自动枚举多个 NAT 内网地址时，添加 `MULTI_IP_INCLUDE_PRIVATE=true`。显式 `IPS` 不受此过滤影响。
- 单出口不配置 `PORTS` 时使用 `ARGO_PORT`，未设置则为 `8001`；多出口未配置 `PORTS` 时从该端口开始按 `10` 递增。推荐为多出口明确填写等长的三个列表。

## 2. 配置 Cloudflare Tunnel Routes

创建一个固定 Tunnel，获取 Token。在该 Tunnel 的 Routes 中添加 Published application：

| 域名 | Service |
|---|---|
| node.example.com（单出口） | `http://localhost:8001` |
| net1.example.com（多出口第一个） | `http://localhost:8001` |
| net2.example.com | `http://localhost:8002` |
| net3.example.com | `http://localhost:8003` |

按实际配置选择单出口或多出口，不需要同时添加表中全部域名。Service 类型为 HTTP；端口必须与应用主入口一致。

Tunnel 页面显示的 **Origin IP** 是 connector 连接 Cloudflare 的源地址，不代表各代理节点访问目标网站时的出口。验证出口应使用对应节点访问公网 IP 查询服务。

## 3. Linux 主机使用 Compose 部署

安装可用的 Docker Engine 和 Compose 插件，先确认服务可连接：

```bash
docker info
docker compose version
```

拉取项目代码，进入项目根目录，准备好第一步的环境文件，然后执行：

```bash
docker compose up -d --build
docker compose ps
```

当前 [Compose 配置](docker-compose.yml) 从本地源码构建，使用 host 网络：

- 单出口、多出口 Linux 主机均可保持此配置，无需自动切换 bridge。
- 绑定宿主源 IP 必须让容器看得到该地址；普通 bridge 加端口映射不能替代 host 网络。
- Tunnel 和 Xray 共享网络命名空间，回源使用 localhost，无需端口映射，也无需对公网开放代理入口端口。
- host 网络共享宿主端口，需避免主入口与内部 fallback 端口冲突。多出口内部端口为主端口加 `1000/2000/3000/4000`，只监听回环地址。

旧版独立 Compose 可将命令中的 `docker compose` 换为 `docker-compose`，但推荐升级工具，而不是持续降级配置或基础镜像。

### 更新、重建与停止

同步最新代码及配置后，重新构建并替换容器：

```bash
git pull
docker compose up -d --build --force-recreate
```

如需先清理旧容器和旧网络，再启动：

```bash
docker compose down --remove-orphans
docker compose up -d --build
```

以上操作会中断现有连接，不删除项目环境文件；不要为了普通更新添加删除数据卷的参数。

### 宝塔面板

可使用同一份 Compose 配置，但本机构建要求服务器的构建目录具有完整源码及 [Dockerfile](Dockerfile)。仅粘贴 Compose 内容不会自动克隆 GitHub。面板将编排保存到独立目录时，须核对本地构建路径及环境文件位置。

## 4. Railway 部署

1. 创建 Service，通过 GitHub 授权连接仓库。
2. 使用仓库根目录的 [Dockerfile](Dockerfile) 构建；启动入口已由镜像指定。
3. 在 Variables 中填写单出口示例中的域名和 Token。
4. 在 Cloudflare 配置 `http://localhost:8001` 回源，等待部署完成。

Railway 不执行本项目的 Compose 配置，不要求 host 网络权限，也不需要配置 `IPS`、`PORTS`、宿主端口映射或 Railway Public Domain。程序使用平台提供的默认出口。

兼容原变量：`ARGO_DOMAIN`、`DOMAIN` 和 `ARGO_AUTH`。代码读取域名的优先级为 `ARGO_DOMAIN` → `DOMAINS` → `DOMAIN`，凭据为 `ARGO_AUTH` → `AUTH`。使用仓库 Compose 部署时，按示例填写 `AUTH`，避免额外设置互相矛盾的别名。

## 5. 查看日志并获取 Base64 分享链接

在项目目录查看最近日志并持续跟踪：

```bash
docker compose logs --tail=200 -f railway-passwall
```

也可在任意目录按容器名查看：

```bash
docker logs --tail=200 -f railway-passwall
```

按 Ctrl+C 只退出日志跟踪，不停止容器。Railway 在服务部署的 Deploy Logs 中查看相同输出。

正常情况下会显示域名和凭据均已加载，以及对应出口组的分享内容：

```text
ENV_LOADED DOMAIN=yes AUTH=yes
===== SUBSCRIPTION 1/3 net1.example.com -> ... -> localhost:8001 =====
<第一套 Base64>
===== SUBSCRIPTION 2/3 net2.example.com -> ... -> localhost:8002 =====
<第二套 Base64>
===== SUBSCRIPTION 3/3 net3.example.com -> ... -> localhost:8003 =====
<第三套 Base64>
```

复制每个标题后紧接着的完整 Base64 行导入客户端，不包含标题、日志前缀和保存提示。每套解码后包含 VLESS、VMess、Trojan 三条分享链接，使用对应域名。

主入口端口是 Cloudflare 内部回源端口；客户端仍通过 TLS `443` 连接，不应把分享链接的连接端口改为 `8001/8002/8003`。

## 6. 简要排错

- **Tunnel Healthy 但代理不通**：Healthy 仅表示 connector 在线，不保证 Xray 已启动或回源成功。先查看容器日志及 [Xray 日志](.tmp/xray.log)：

  ```bash
  docker exec railway-passwall sh -c 'cat /tmp/.tmp/xray.log'
  ```

- **多节点仍是同一出口**：确认容器为 host 网络、绑定地址属于宿主机；生成配置中 `sendThrough` 必须位于 outbound 顶层，每组全部 fallback 入站标签都应匹配对应出站。
- **默认出口或源地址验证**：在宿主机指定源地址查询公网出口，不改变路由配置：

  ```bash
  curl -4 --noproxy '*' --interface 172.18.30.34 --max-time 10 https://api.ipify.org
  ```

- **基础镜像拉取、Compose 格式或 daemon 错误**：检查 Docker/Compose 版本和 Docker 服务状态；与 Tunnel 配置无关。

## 7. 可选参数与开发

| 参数 | 用途 |
|---|---|
| `UUID` | 覆盖客户端 ID；建议自行设置，客户端与服务端保持一致 |
| `CFIP` / `CFPORT` | 客户端连接地址及端口，默认使用项目内置地址和 443 |
| `NAME` | 节点名称前缀；不设置时使用域名 |
| `ARGO_PORT` | 主入口起始端口，默认 8001 |
| `MULTI_IP_MODE=false` | 显式使用原单出口配置 |
| `MULTI_IP_INCLUDE_PRIVATE=true` | 自动筛选时允许私网 IPv4 |

修改 [入口模板](index.template.js) 后运行：

```bash
npm install --include=dev
node scripts/test-config.js
npm run build
node --check index.js
```

构建脚本仅生成通用的 [运行入口](index.js)，不读取本地环境文件或写入真实密钥。

**不要提交真实环境文件、Tunnel Token、订阅链接或日志。** [忽略规则](.gitignore) 已排除本地环境文件及运行临时目录；示例文件只应保留占位值。
