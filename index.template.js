#!/usr/bin/env node

// 在混淆前显式读取 Railway Variables，避免依赖运行时属性访问被优化变形。
// 支持两组变量名：标准 ARGO_DOMAIN/ARGO_AUTH 与简写 DOMAIN/AUTH，标准优先。
const ENV = process.env || {};
const ENV_ARGO_DOMAIN = ENV["ARGO_DOMAIN"] || ENV["DOMAINS"] || ENV["DOMAIN"] || "";
const ENV_ARGO_AUTH = ENV["ARGO_AUTH"] || ENV["AUTH"] || "";
const ENV_UUID = ENV["UUID"] || "aae820aa-a042-4938-9fc5-fe1d2b492c1c";
const ENV_CFIP = ENV["CFIP"] || "cdns.doon.eu.org";

console.log("ENV_LOADED DOMAIN=" + (ENV_ARGO_DOMAIN ? "yes" : "no") + " AUTH=" + (ENV_ARGO_AUTH ? "yes" : "no"));

const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const UPLOAD_URL = process.env.UPLOAD_URL || '';      // 节点或订阅自动上传地址,需填写部署Merge-sub项目后的首页地址,例如：https://merge.xxx.com
const PROJECT_URL = process.env.PROJECT_URL || '';    // 需要上传订阅或保活时需填写项目分配的url,例如：https://google.com
const AUTO_ACCESS = process.env.AUTO_ACCESS || false; // false关闭自动保活，true开启,需同时填写PROJECT_URL变量
const FILE_PATH = process.env.FILE_PATH || '.tmp';   // 运行目录,sub节点文件保存目录
const UUID = ENV_UUID; // 使用哪吒v1,在不同的平台运行需修改UUID,否则会覆盖
const NEZHA_SERVER = ENV.NEZHA_SERVER || '';        // 哪吒v1填写形式: nz.abc.com:8008  哪吒v0填写形式：nz.abc.com
const NEZHA_PORT = ENV.NEZHA_PORT || '';            // 使用哪吒v1请留空，哪吒v0需填写
const NEZHA_KEY = ENV.NEZHA_KEY || '';              // 哪吒v1的NZ_CLIENT_SECRET或哪吒v0的agent密钥
const ARGO_DOMAIN = ENV_ARGO_DOMAIN;          // 固定隧道域名,留空即启用临时隧道
const ARGO_AUTH = ENV_ARGO_AUTH;              // 固定隧道密钥json或token,留空即启用临时隧道,json获取地址：https://json.zone.id
const ARGO_PORT = Number(ENV.ARGO_PORT || String(ENV.PORTS || '').split(',')[0].trim() || 8001);            // 固定隧道端口,使用token需在cloudflare后台设置和这里一致
const CFIP = ENV_CFIP;            // 节点优选域名或优选ip
const CFPORT = process.env.CFPORT || 443;                   // 节点优选域名或优选ip对应的端口
const NAME = process.env.NAME || '';                        // 节点名称

// 多出口 IP 模式：默认启用。
// IPS 为空时，要求 host 网络，自动枚举宿主可见的有效 IPv4。
// IPS 非空时，固定选择本地源地址；绑定宿主 IP 仍须 host 网络，不能用 ports 映射代替。
const MULTI_IP_MODE = String(ENV.MULTI_IP_MODE || 'true').toLowerCase() !== 'false';
const MULTI_IP_INCLUDE_PRIVATE = String(ENV.MULTI_IP_INCLUDE_PRIVATE || '').toLowerCase() === 'true';
const MULTI_IP_INCLUDE_LOOPBACK = String(ENV.MULTI_IP_INCLUDE_LOOPBACK || '').toLowerCase() === 'true';
const MULTI_IP_IFACE_PREFIXES = String(ENV.MULTI_IP_IFACE_PREFIXES || 'eth,ens,enp,eno,em,bond,br,wan,lan')
  .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const MULTI_IP_IFACE_EXCLUDE = String(ENV.MULTI_IP_IFACE_EXCLUDE || 'docker,br-,veth,virbr,vmbr,tailscale,ts,tun,tap,ppp,lo,cni,flannel,cali,weave,macvlan,ipvlan,site,utun,wg,wireguard')
  .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

function splitList(value) {
  return String(value || '').split(/[,\s]+/).map(x => x.trim()).filter(Boolean);
}

// 用户示例：DOMAINS=a,b,c  PORTS=8001,8002,8003  IPS=（空则自动枚举）
const MULTI_DOMAINS = splitList(ENV.DOMAINS || ENV.ARGO_DOMAIN || ENV.DOMAIN);
const MULTI_PORTS = splitList(ENV.PORTS || ENV.ARGO_PORTS || '').map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 65536);
const MULTI_IP_IPS = splitList(ENV.IPS || ENV.MULTI_IP_IPS);

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  const a = parts[0], b = parts[1];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  return false;
}

function ifaceAllowed(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return false;
  if (MULTI_IP_INCLUDE_LOOPBACK && n === 'lo') return true;
  if (MULTI_IP_IFACE_EXCLUDE.some(prefix => n.includes(prefix))) return false;
  if (MULTI_IP_IFACE_PREFIXES.some(prefix => n.startsWith(prefix))) return true;
  return false;
}

// 返回本实例要使用的 IPv4 出口列表。
// 显式 IPS 优先；为空时枚举宿主/容器内可见 IPv4。自动枚举要求 host 网络。
function getEffectiveIPv4s() {
  if (MULTI_IP_IPS.length > 0) {
    if (MULTI_IP_IPS.some(ip => !IPV4_RE.test(ip))) throw new Error('IPS 包含无效 IPv4 地址');
    const manual = [...new Set(MULTI_IP_IPS)];
    console.log('IPS manual:', manual.join(',') || '(none)');
    return manual;
  }

  const found = [];
  const interfaces = os.networkInterfaces() || {};
  Object.keys(interfaces).forEach(name => {
    if (!ifaceAllowed(name)) return;
    (interfaces[name] || []).forEach(info => {
      if (info.family !== 'IPv4') return;
      if (!IPV4_RE.test(info.address)) return;
      if (info.internal && !MULTI_IP_INCLUDE_LOOPBACK) return;
      if (isPrivateIPv4(info.address) && !MULTI_IP_INCLUDE_PRIVATE) return;
      found.push(info.address);
    });
  });

  const unique = [...new Set(found)];
  console.log('MULTI_IP discovered:', unique.join(',') || '(none)');
  return unique;
}

function getBasePorts(count) {
  if (MULTI_PORTS.length >= count) return MULTI_PORTS.slice(0, count);
  const first = MULTI_PORTS[0] || (Number(ARGO_PORT) || 8001);
  return Array.from({ length: count }, (_, i) => first + i * 10);
}

function getDomains(count) {
  if (MULTI_DOMAINS.length > 0) {
    return Array.from({ length: count }, (_, i) => MULTI_DOMAINS[i] || MULTI_DOMAINS[0]);
  }
  return Array.from({ length: count }, (_, i) => `net${i + 1}`);
}

function getRoutePlan() {
  const discovered = getEffectiveIPv4s();
  // 未显式绑定且只有一个或没有候选地址：保留系统默认出口，兼容 PaaS 私网容器。
  const ips = MULTI_IP_IPS.length || discovered.length > 1
    ? discovered : [null];
  const ports = getBasePorts(ips.length);
  const domains = getDomains(ips.length);
  return ips.map((ip, i) => ({ ip, port: ports[i], domain: domains[i] }));
}

function buildFallbacks(basePort) {
  // 主入口与内部协议 inbound 不能使用同一端口，否则 Xray 重复监听会导致部分 inbound 启动失败。
  // 每个出口实例使用独立内部端口段：base+1000、base+2000、base+3000、base+4000。
  return [
    { dest: basePort + 1000 },
    { path: "/vless-argo", dest: basePort + 2000 },
    { path: "/vmess-argo", dest: basePort + 3000 },
    { path: "/trojan-argo", dest: basePort + 4000 }
  ];
}

function buildInboundsForIp(ip, index, basePort) {
  const tag = `in-${index}-${ip}`;
  // 主端口只负责 TCP fallback 分流；内部协议 inbound 使用独立端口，避免同端口重复监听。
  const vlessPort = basePort + 1000;
  const wsVlessPort = basePort + 2000;
  const wsVmessPort = basePort + 3000;
  const wsTrojanPort = basePort + 4000;

  return [
    {
      tag,
      port: basePort,
      listen: "0.0.0.0",
      protocol: 'vless',
      settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: buildFallbacks(basePort) },
      streamSettings: { network: 'tcp' }
    },
    {
      tag: `vless-${index}-${ip}`,
      listen: "127.0.0.1",
      port: vlessPort,
      protocol: "vless",
      settings: { clients: [{ id: UUID }], decryption: "none" },
      streamSettings: { network: "tcp", security: "none" }
    },
    {
      tag: `vless-ws-${index}-${ip}`,
      listen: "127.0.0.1",
      port: wsVlessPort,
      protocol: "vless",
      settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" },
      streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } },
      sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false }
    },
    {
      tag: `vmess-ws-${index}-${ip}`,
      listen: "127.0.0.1",
      port: wsVmessPort,
      protocol: "vmess",
      settings: { clients: [{ id: UUID, alterId: 0 }] },
      streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } },
      sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false }
    },
    {
      tag: `trojan-ws-${index}-${ip}`,
      listen: "127.0.0.1",
      port: wsTrojanPort,
      protocol: "trojan",
      settings: { clients: [{ password: UUID }] },
      streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } },
      sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false }
    }
  ];
}

// 创建运行文件夹
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
  console.log(`${FILE_PATH} is created`);
} else {
  console.log(`${FILE_PATH} already exists`);
}

// 生成随机6位字符
function generateRandomName() {
  const characters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// 全局常量
const npmName = generateRandomName();
const webName = generateRandomName();
const botName = generateRandomName();
const phpName = generateRandomName();
let npmPath = path.join(FILE_PATH, npmName);
let phpPath = path.join(FILE_PATH, phpName);
let webPath = path.join(FILE_PATH, webName);
let botPath = path.join(FILE_PATH, botName);
let subPath = path.join(FILE_PATH, 'sub.txt');
let listPath = path.join(FILE_PATH, 'list.txt');
let bootLogPath = path.join(FILE_PATH, 'boot.log');
let configPath = path.join(FILE_PATH, 'config.json');

// 如果订阅器上存在历史运行节点则先删除
function deleteNodes() {
  try {
    if (!UPLOAD_URL) return;
    if (!fs.existsSync(subPath)) return;

    let fileContent;
    try {
      fileContent = fs.readFileSync(subPath, 'utf-8');
    } catch {
      return null;
    }

    const decoded = Buffer.from(fileContent, 'base64').toString('utf-8');
    const nodes = decoded.split('\n').filter(line =>
      /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line)
    );

    if (nodes.length === 0) return;

    axios.post(`${UPLOAD_URL}/api/delete-nodes`,
      JSON.stringify({ nodes }),
      { headers: { 'Content-Type': 'application/json' } }
    ).catch((error) => {
      return null;
    });
    return null;
  } catch (err) {
    return null;
  }
}

// 清理历史文件
function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(FILE_PATH);
    files.forEach(file => {
      const filePath = path.join(FILE_PATH, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        // 忽略所有错误，不记录日志
      }
    });
  } catch (err) {
    // 忽略所有错误，不记录日志
  }
}

// 生成xr-ay配置文件
async function generateConfig() {
  let inbounds;
  let outbounds;
  let routing;

  if (MULTI_IP_MODE) {
    const plan = getRoutePlan();
    const localIPv4s = new Set(Object.values(os.networkInterfaces()).flat()
      .filter(info => info.family === 'IPv4').map(info => info.address));
    for (const item of plan) {
      if (item.ip && !localIPv4s.has(item.ip)) {
        throw new Error(`出口地址 ${item.ip} 不在当前网络命名空间中。绑定宿主 IP 必须使用 network_mode: host；填写 IPS 或添加 ports 映射不能代替 host 网络。`);
      }
    }
    inbounds = [];
    outbounds = [];
    const rules = [];

    plan.forEach((item, i) => {
      const index = i + 1;
      const ip = item.ip;
      const currentBase = item.port;
      const instanceInbounds = buildInboundsForIp(ip, index, currentBase);
      const inTags = instanceInbounds.map(x => x.tag).filter(Boolean);
      const outTag = `out-${index}-${ip}`;
      inbounds.push(...instanceInbounds);
      outbounds.push({ tag: outTag, protocol: "freedom", ...(ip ? { sendThrough: ip } : {}), settings: {} });
      // 必须把该实例的全部 inbound（主入口 + 所有 fallback 子 inbound）都路由到该出口，
      // 否则 WS fallback 实际进入子 inbound 后会走默认 direct，表现为死抱 eth0。
      rules.push({ type: "field", inboundTag: inTags, outboundTag: outTag });
    });

    outbounds.push({ protocol: "freedom", tag: "direct", settings: {} });
    outbounds.push({ protocol: "blackhole", tag: "block" });
    // 不引用 geoip:private：精简版 xray 内核可能没有 geoip.dat，
    // 否则会导致配置加载失败。私网访问默认由 freedom 出站处理。

    routing = { domainStrategy: "AsIs", rules };
    console.log(`MULTI_IP_MODE enabled, ${plan.length} outbound(s): ${plan.map(x => x.ip).join(', ')}`);
    console.log(`MULTI_IP routes: ${plan.map(x => `${x.domain}->localhost:${x.port}->${x.ip}`).join(', ')}`);
  } else {
    inbounds = [
      { port: ARGO_PORT, protocol: 'vless', settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: [{ dest: 3001 }, { path: "/vless-argo", dest: 3002 }, { path: "/vmess-argo", dest: 3003 }, { path: "/trojan-argo", dest: 3004 }] }, streamSettings: { network: 'tcp' } },
      { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
      { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3004, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } }
    ];
    outbounds = [{ protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "block" }];
  }

  const config = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds,
    dns: { servers: ["https+local://8.8.8.8/dns-query"] },
    outbounds
  };

  if (routing) config.routing = routing;

  fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));
}

// 判断系统架构
function getSystemArchitecture() {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
    return 'arm';
  } else {
    return 'amd';
  }
}

// 下载对应系统架构的依赖文件
function downloadFile(fileName, fileUrl, callback) {
  const filePath = fileName;

  if (!fs.existsSync(FILE_PATH)) {
    fs.mkdirSync(FILE_PATH, { recursive: true });
  }

  const writer = fs.createWriteStream(filePath);

  axios({
    method: 'get',
    url: fileUrl,
    responseType: 'stream',
  })
    .then(response => {
      response.data.pipe(writer);

      writer.on('finish', () => {
        writer.close();
        console.log(`Download ${path.basename(filePath)} successfully`);
        callback(null, filePath);
      });

      writer.on('error', err => {
        fs.unlink(filePath, () => { });
        const errorMessage = `Download ${path.basename(filePath)} failed: ${err.message}`;
        console.error(errorMessage);
        callback(errorMessage);
      });
    })
    .catch(err => {
      const errorMessage = `Download ${path.basename(filePath)} failed: ${err.message}`;
      console.error(errorMessage);
      callback(errorMessage);
    });
}

// 下载并运行依赖文件
async function downloadFilesAndRun() {
  const architecture = getSystemArchitecture();
  const filesToDownload = getFilesForArchitecture(architecture);

  if (filesToDownload.length === 0) {
    console.log(`Can't find a file for the current architecture`);
    return;
  }

  const downloadPromises = filesToDownload.map(fileInfo => {
    return new Promise((resolve, reject) => {
      downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err, filePath) => {
        if (err) {
          reject(err);
        } else {
          resolve(filePath);
        }
      });
    });
  });

  try {
    await Promise.all(downloadPromises);
  } catch (err) {
    console.error('Error downloading files:', err);
    return;
  }

  function authorizeFiles(filePaths) {
    const newPermissions = 0o775;
    filePaths.forEach(absoluteFilePath => {
      if (fs.existsSync(absoluteFilePath)) {
        fs.chmod(absoluteFilePath, newPermissions, (err) => {
          if (err) {
            console.error(`Empowerment failed for ${absoluteFilePath}: ${err}`);
          } else {
            console.log(`Empowerment success for ${absoluteFilePath}: ${newPermissions.toString(8)}`);
          }
        });
      }
    });
  }
  const filesToAuthorize = NEZHA_PORT ? [npmPath, webPath, botPath] : [phpPath, webPath, botPath];
  authorizeFiles(filesToAuthorize);

  // 运行ne-zha
  if (NEZHA_SERVER && NEZHA_KEY) {
    if (!NEZHA_PORT) {
      const port = NEZHA_SERVER.includes(':') ? NEZHA_SERVER.split(':').pop() : '';
      const tlsPorts = new Set(['443', '8443', '2096', '2087', '2083', '2053']);
      const nezhatls = tlsPorts.has(port) ? 'true' : 'false';
      const configYaml = `
client_secret: ${NEZHA_KEY}
debug: false
disable_auto_update: true
disable_command_execute: false
disable_force_update: true
disable_nat: false
disable_send_query: false
gpu: false
insecure_tls: true
ip_report_period: 1800
report_delay: 4
server: ${NEZHA_SERVER}
skip_connection_count: true
skip_procs_count: true
temperature: false
tls: ${nezhatls}
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: ${UUID}`;

      fs.writeFileSync(path.join(FILE_PATH, 'config.yaml'), configYaml);

      const command = `nohup ${phpPath} -c "${FILE_PATH}/config.yaml" >/dev/null 2>&1 &`;
      try {
        await exec(command);
        console.log(`${phpName} is running`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`php running error: ${error}`);
      }
    } else {
      let NEZHA_TLS = '';
      const tlsPorts = ['443', '8443', '2096', '2087', '2083', '2053'];
      if (tlsPorts.includes(NEZHA_PORT)) {
        NEZHA_TLS = '--tls';
      }
      const command = `nohup ${npmPath} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${NEZHA_TLS} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`;
      try {
        await exec(command);
        console.log(`${npmName} is running`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`npm running error: ${error}`);
      }
    }
  } else {
    console.log('NEZHA variable is empty,skip running');
  }

  // 运行xr-ay
  const command1 = `nohup ${webPath} -c ${FILE_PATH}/config.json >${FILE_PATH}/xray.log 2>&1 &`;
  try {
    await exec(command1);
    console.log(`${webName} is running`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const xrayLog = fs.existsSync(path.join(FILE_PATH, 'xray.log')) ? fs.readFileSync(path.join(FILE_PATH, 'xray.log'), 'utf-8') : '';
      if (xrayLog.trim()) console.log(`xray log:\n${xrayLog.slice(-4000)}`);
    } catch (e) {}
  } catch (error) {
    console.error(`web running error: ${error}`);
  }

  // 运行cloud-fared
  if (fs.existsSync(botPath)) {
    let args;

    if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
    } else if (ARGO_AUTH.match(/TunnelSecret/)) {
      args = `tunnel --edge-ip-version auto --config ${FILE_PATH}/tunnel.yml run`;
    } else {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
    }

    try {
      await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
      console.log(`${botName} is running`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Error executing command: ${error}`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

// 根据系统架构返回对应的url
function getFilesForArchitecture(architecture) {
  let baseFiles;
  if (architecture === 'arm') {
    baseFiles = [
      { fileName: webPath, fileUrl: "https://arm64.ssss.nyc.mn/web" },
      { fileName: botPath, fileUrl: "https://arm64.ssss.nyc.mn/bot" }
    ];
  } else {
    baseFiles = [
      { fileName: webPath, fileUrl: "https://amd64.ssss.nyc.mn/web" },
      { fileName: botPath, fileUrl: "https://amd64.ssss.nyc.mn/bot" }
    ];
  }

  if (NEZHA_SERVER && NEZHA_KEY) {
    if (NEZHA_PORT) {
      const npmUrl = architecture === 'arm'
        ? "https://arm64.ssss.nyc.mn/agent"
        : "https://amd64.ssss.nyc.mn/agent";
      baseFiles.unshift({
        fileName: npmPath,
        fileUrl: npmUrl
      });
    } else {
      const phpUrl = architecture === 'arm'
        ? "https://arm64.ssss.nyc.mn/v1"
        : "https://amd64.ssss.nyc.mn/v1";
      baseFiles.unshift({
        fileName: phpPath,
        fileUrl: phpUrl
      });
    }
  }

  return baseFiles;
}

// 获取固定隧道json
function argoType() {
  if (!ARGO_AUTH || !ARGO_DOMAIN) {
    console.log("ARGO_DOMAIN or ARGO_AUTH is empty, use quick tunnels");
    return;
  }

  if (ARGO_AUTH.includes('TunnelSecret')) {
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.json'), ARGO_AUTH);

    let ingress;
    if (MULTI_IP_MODE) {
      const plan = getRoutePlan();
      if (plan.length === 0) {
        throw new Error('MULTI_IP_MODE 开启但未发现有效 IPv4 出口地址，无法生成 tunnel ingress');
      }
      ingress = plan.map(item => {
        return `    - hostname: ${item.domain}\n      service: http://localhost:${item.port}\n      originRequest:\n        noTLSVerify: true`;
      }).join('\n');
      console.log('MULTI_IP tunnel ingress:', plan.map(x => `${x.domain}->localhost:${x.port}->${x.ip}`).join(', '));
    } else {
      ingress = `    - hostname: ${ARGO_DOMAIN}\n      service: http://localhost:${ARGO_PORT}\n      originRequest:\n        noTLSVerify: true`;
    }

    const tunnelYaml = `
  tunnel: ${ARGO_AUTH.split('"')[11]}
  credentials-file: ${path.join(FILE_PATH, 'tunnel.json')}
  protocol: http2
  
  ingress:
${ingress}
    - service: http_status:404
  `;
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.yml'), tunnelYaml);
  } else {
    if (MULTI_IP_MODE) {
      const plan = getRoutePlan();
      console.log(`Using token connect to tunnel. MULTI_IP_MODE requires Cloudflare Routes: ${plan.map(x => `${x.domain}->localhost:${x.port}->${x.ip}`).join(', ')}`);
    } else {
      console.log(`Using token connect to tunnel, please set ${ARGO_PORT} in clouudflare`);
    }
  }
}

// 获取临时隧道domain
async function extractDomains() {
  let argoDomain;

  if (ARGO_AUTH && ARGO_DOMAIN) {
    if (MULTI_IP_MODE) {
      const plan = getRoutePlan();
      console.log('ARGO_DOMAIN list:', plan.map(x => x.domain).join(', '));
      await generateLinksForPlan(plan);
    } else {
      argoDomain = ARGO_DOMAIN;
      console.log('ARGO_DOMAIN:', argoDomain);
      await generateLinks(argoDomain);
    }
  } else {
    try {
      const fileContent = fs.readFileSync(path.join(FILE_PATH, 'boot.log'), 'utf-8');
      const lines = fileContent.split('\n');
      const argoDomains = [];
      lines.forEach((line) => {
        const domainMatch = line.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/);
        if (domainMatch) {
          const domain = domainMatch[1];
          argoDomains.push(domain);
        }
      });

      if (argoDomains.length > 0) {
        argoDomain = argoDomains[0];
        console.log('ArgoDomain:', argoDomain);
        await generateLinks(argoDomain);
      } else {
        console.log('ArgoDomain not found, re-running bot to obtain ArgoDomain');
        fs.unlinkSync(path.join(FILE_PATH, 'boot.log'));
        async function killBotProcess() {
          try {
            if (process.platform === 'win32') {
              await exec(`taskkill /f /im ${botName}.exe > nul 2>&1`);
            } else {
              await exec(`pkill -f "[${botName.charAt(0)}]${botName.substring(1)}" > /dev/null 2>&1`);
            }
          } catch (error) {
            // 忽略输出
          }
        }
        killBotProcess();
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
        try {
          await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
          console.log(`${botName} is running`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await extractDomains();
        } catch (error) {
          console.error(`Error executing command: ${error}`);
        }
      }
    } catch (error) {
      console.error('Error reading boot.log:', error);
    }
  }
}

// 获取isp信息
async function getMetaInfo() {
  try {
    const response1 = await axios.get('https://api.ip.sb/geoip', { headers: { 'User-Agent': 'Mozilla/5.0', timeout: 3000 } });
    if (response1.data && response1.data.country_code && response1.data.isp) {
      return `${response1.data.country_code}-${response1.data.isp}`.replace(/\s+/g, '_');
    }
  } catch (error) {
    try {
      const response2 = await axios.get('http://ip-api.com/json', { headers: { 'User-Agent': 'Mozilla/5.0', timeout: 3000 } });
      if (response2.data && response2.data.status === 'success' && response2.data.countryCode && response2.data.org) {
        return `${response2.data.countryCode}-${response2.data.org}`.replace(/\s+/g, '_');
      }
    } catch (error) {
      // console.error('Backup API also failed');
    }
  }
  return 'Unknown';
}

// 多出口模式下，按域名数量生成多套订阅 base64
async function generateLinksForPlan(plan) {
  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    console.log(`\n===== SUBSCRIPTION ${i + 1}/${plan.length} ${item.domain} -> ${item.ip} -> localhost:${item.port} =====`);
    await generateLinks(item.domain);
  }
}

// 生成 list 和 sub 信息
async function generateLinks(argoDomain) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const linkName = NAME || argoDomain;
      const vlessName = `${linkName}-vless`;
      const vmessName = `${linkName}-vmess`;
      const trojanName = `${linkName}-trojan`;
      const VMESS = { v: '2', ps: vmessName, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: argoDomain, path: '/vmess-argo?ed=2560', tls: 'tls', sni: argoDomain, alpn: '', fp: 'firefox' };
      const subTxt = `
vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Fvless-argo%3Fed%3D2560#${vlessName}

vmess://${Buffer.from(JSON.stringify(VMESS)).toString('base64')}

trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Ftrojan-argo%3Fed%3D2560#${trojanName}
    `;
      console.log(Buffer.from(subTxt).toString('base64'));
      fs.writeFileSync(subPath, Buffer.from(subTxt).toString('base64'));
      console.log(`${FILE_PATH}/sub.txt saved successfully`);
      // 将订阅内容保存到全局变量，供 http 服务器使用
      subContent = Buffer.from(subTxt).toString('base64');
      uploadNodes();
      resolve(subTxt);
    }, 2000);
  });
}

// 自动上传节点或订阅
async function uploadNodes() {
  if (UPLOAD_URL && PROJECT_URL) {
    const subscriptionUrl = `${PROJECT_URL}/${SUB_PATH}`;
    const jsonData = {
      subscription: [subscriptionUrl]
    };
    try {
      const response = await axios.post(`${UPLOAD_URL}/api/add-subscriptions`, jsonData, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response && response.status === 200) {
        console.log('Subscription uploaded successfully');
        return response;
      } else {
        return null;
      }
    } catch (error) {
      if (error.response) {
        if (error.response.status === 400) {
          // console.error('Subscription already exists');
        }
      }
    }
  } else if (UPLOAD_URL) {
    if (!fs.existsSync(listPath)) return;
    const content = fs.readFileSync(listPath, 'utf-8');
    const nodes = content.split('\n').filter(line => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line));

    if (nodes.length === 0) return;

    const jsonData = JSON.stringify({ nodes });

    try {
      const response = await axios.post(`${UPLOAD_URL}/api/add-nodes`, jsonData, {
        headers: { 'Content-Type': 'application/json' }
      });
      if (response && response.status === 200) {
        console.log('Nodes uploaded successfully');
        return response;
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  } else {
    // console.log('Skipping upload nodes');
    return;
  }
}

// 已移除 90 秒后清理逻辑：Railway 下主进程需要持续存活，
// 不能在主进程退出后再依赖后台 xray/tunnel 子进程维持服务。

// 自动访问项目URL
async function AddVisitTask() {
  if (!AUTO_ACCESS || !PROJECT_URL) {
    console.log("Skipping adding automatic access task");
    return;
  }

  try {
    const response = await axios.post('https://oooo.serv00.net/add-url', {
      url: PROJECT_URL
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log(`automatic access task added successfully`);
    return response;
  } catch (error) {
    console.error(`Add automatic access task faild: ${error.message}`);
    return null;
  }
}

// 主运行逻辑
async function startserver() {
  try {
    deleteNodes();
    cleanupOldFiles();
    argoType();
    await generateConfig();
    await downloadFilesAndRun();
    await extractDomains();
    await AddVisitTask();
  } catch (error) {
    console.error('Error in startserver:', error);
  }
}
startserver().catch(error => {
  console.error('Unhandled error in startserver:', error);
});

// 保持 Node 主进程常驻，避免 Railway 因事件循环耗尽判定服务退出。
setInterval(() => {}, 1 << 30);

// 已移除 3000 端口 HTTP 服务与 /sub 路由。
// 订阅内容由本地 make.sh 生成到项目根目录 sub.txt，不随镜像运行。
