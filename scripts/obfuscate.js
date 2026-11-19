#!/usr/bin/env node
'use strict';

// 使用 javascript-obfuscator 对注入后的入口做混淆，生成运行时 index.js。
// 用法: node scripts/obfuscate.js <input> <output>

const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const inputPath = path.resolve(process.argv[2] || 'index.generated.js');
const outputPath = path.resolve(process.argv[3] || 'index.js');

const result = JavaScriptObfuscator.obfuscate(
  require('fs').readFileSync(inputPath, 'utf8'),
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
    simplify: true,
    sourceMap: false,
    splitStrings: true,
    splitStringsChunkLength: 12,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    target: 'node'
  }
);

require('fs').writeFileSync(outputPath, result.getObfuscatedCode(), 'utf8');
console.log(`obfuscated ${path.basename(inputPath)} -> ${path.basename(outputPath)}`);
