#!/usr/bin/env node
'use strict';

// 把 ARGO_DOMAIN / ARGO_AUTH 的真实值注入模板，生成中间文件。
// 用法: node scripts/inject-env.js <template> <output> <domain> <auth>

const fs = require('fs');
const path = require('path');

const [tplPath, outPath, domain, auth] = process.argv.slice(2);
if (!tplPath || !outPath || domain === undefined || auth === undefined) {
  console.error('usage: inject-env.js <template> <output> <domain> <auth>');
  process.exit(1);
}

let code = fs.readFileSync(path.resolve(tplPath), 'utf8');

function inject(name, value) {
  const prefix = 'process.env.' + name + ' || ';
  const start = code.indexOf(prefix);
  if (start === -1) throw new Error('模板中找不到 ' + name + ' 初始化行');

  // 从 `||` 后的默认值起始位置开始，找到该行结尾的分号或行尾
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

  const literal = JSON.stringify(value);
  code = code.slice(0, start + prefix.length) + literal + code.slice(i);
}

inject('ARGO_DOMAIN', domain);
inject('ARGO_AUTH', auth);
fs.writeFileSync(path.resolve(outPath), code, 'utf8');
console.log('injected ARGO_DOMAIN / ARGO_AUTH -> ' + path.basename(outPath));
