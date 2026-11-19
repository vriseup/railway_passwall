#!/usr/bin/env node
'use strict';

// 把节点变量真实值注入模板，生成中间文件。
// 变量: ARGO_DOMAIN / ARGO_AUTH / UUID / CFIP
// 用法:
//   node scripts/inject-env.js <template> <output> <json-or-kv...>
// 兼容旧用法:
//   node scripts/inject-env.js <template> <output> <domain> <auth>

const fs = require('fs');
const path = require('path');

const [tplPath, outPath, ...rest] = process.argv.slice(2);
if (!tplPath || !outPath || rest.length === 0) {
  console.error('usage: inject-env.js <template> <output> <json:values>');
  process.exit(1);
}

let values = {};
if (rest.length === 1) {
  try {
    values = JSON.parse(rest[0]);
  } catch (e) {
    console.error('第一个参数必须是 JSON 字符串');
    process.exit(1);
  }
} else if (rest.length === 2) {
  values = { ARGO_DOMAIN: rest[0], ARGO_AUTH: rest[1] };
} else {
  console.error('参数数量不正确');
  process.exit(1);
}

let code = fs.readFileSync(path.resolve(tplPath), 'utf8');

function inject(name, value) {
  if (value === undefined || value === null || String(value) === '') {
    throw new Error('变量 ' + name + ' 不能为空');
  }
  const prefix = 'process.env.' + name + ' || ';
  const start = code.indexOf(prefix);
  if (start === -1) throw new Error('模板中找不到 ' + name + ' 初始化行');

  let i = start + prefix.length;
  const quote = code[i];
  if (quote !== "'" && quote !== '"' && quote !== '`') {
    throw new Error(name + ' 默认值不是字符串字面量');
  }
  i += 1;
  while (i < code.length) {
    if (code[i] === '\\') { i += 2; continue; }
    if (code[i] === quote) { i += 1; break; }
    i += 1;
  }

  const literal = JSON.stringify(String(value));
  code = code.slice(0, start + prefix.length) + literal + code.slice(i);
}

for (const name of ['ARGO_DOMAIN', 'ARGO_AUTH', 'UUID', 'CFIP']) {
  inject(name, values[name]);
}

fs.writeFileSync(path.resolve(outPath), code, 'utf8');
console.log('injected ARGO_DOMAIN / ARGO_AUTH / UUID / CFIP -> ' + path.basename(outPath));
