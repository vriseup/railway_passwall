#!/usr/bin/env node
'use strict';

// 将 index.template.js 直接混淆为 index.js。
// 不注入任何真实变量值，运行时继续从 process.env 读取配置。
// 用法: node scripts/obfuscate.js <input> <output>

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const inputPath = path.resolve(process.argv[2] || 'index.template.js');
const outputPath = path.resolve(process.argv[3] || 'index.js');

const result = JavaScriptObfuscator.obfuscate(
  fs.readFileSync(inputPath, 'utf8'),
  {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    renameGlobals: false,
    selfDefending: false,
    simplify: false,
    sourceMap: false,
    // 为避免 process.env 读取被变形，禁用激进的字符串优化
    splitStrings: false,
    stringArray: false,
    stringArrayCallsTransform: false,
    stringArrayWrappersChainedCalls: false,
    target: 'node'
  }
);

fs.writeFileSync(outputPath, result.getObfuscatedCode(), 'utf8');
console.log(`obfuscated ${path.basename(inputPath)} -> ${path.basename(outputPath)}`);
