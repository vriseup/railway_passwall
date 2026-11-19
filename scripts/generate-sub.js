#!/usr/bin/env node
'use strict';

// 本地生成 sub.txt：上面三种协议明文，下面整段 base64，中间空一行。
// 用法: node scripts/generate-sub.js <output> <json:values>

const fs = require('fs');
const path = require('path');

const [outPathRaw, jsonRaw] = process.argv.slice(2);
if (!outPathRaw || !jsonRaw) {
  console.error('usage: generate-sub.js <output> <json:values>');
  process.exit(1);
}

let v;
try {
  v = JSON.parse(jsonRaw);
} catch (e) {
  console.error('参数必须是 JSON 字符串');
  process.exit(1);
}

for (const key of ['ARGO_DOMAIN', 'UUID', 'CFIP']) {
  if (!v[key]) throw new Error('缺少变量: ' + key);
}

const domain = v.ARGO_DOMAIN;
const uuid = v.UUID;
const cfip = v.CFIP;
const port = v.CFPORT || '443';
const fp = v.FP || 'chrome';
const alpn = v.ALPN || 'http/1.1';
const nameSuffix = v.NAME || domain;
const nodeName = `${nameSuffix}`;
const vlessPath = encodeURIComponent('/vless-argo?ed=2560');
const vmessPath = encodeURIComponent('/vmess-argo?ed=2560');
const trojanPath = encodeURIComponent('/trojan-argo?ed=2560');

const vless = `vless://${uuid}@${cfip}:${port}?encryption=none&security=tls&sni=${domain}&fp=${fp}&alpn=${encodeURIComponent(alpn)}&type=ws&host=${domain}&path=${vlessPath}#${nodeName}-vless`;

const vmessObj = {
  v: '2',
  ps: `${nodeName}-vmess`,
  add: cfip,
  port: String(port),
  id: uuid,
  aid: '0',
  scy: 'none',
  net: 'ws',
  type: 'none',
  host: domain,
  path: '/vmess-argo?ed=2560',
  tls: 'tls',
  sni: domain,
  alpn: alpn,
  fp: fp,
  insecure: '0',
  pcs: ''
};
const vmess = `vmess://${Buffer.from(JSON.stringify(vmessObj, null, 2), 'utf8').toString('base64')}`;

const trojan = `trojan://${uuid}@${cfip}:${port}?security=tls&sni=${domain}&fp=${fp}&alpn=${encodeURIComponent(alpn)}&type=ws&host=${domain}&path=${trojanPath}#${nodeName}-trojan`;

const plain = [vless, vmess, trojan].join('\n');
const encoded = Buffer.from(plain, 'utf8').toString('base64');
const output = `${plain}\n\n${encoded}\n`;

const outPath = path.resolve(outPathRaw);
fs.writeFileSync(outPath, output, 'utf8');
console.log(`generated ${path.basename(outPath)}`);
