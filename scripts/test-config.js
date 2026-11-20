const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('index.template.js', 'utf8').split('// 判断系统架构')[0];
const address = ip => ({ family: 'IPv4', address: ip, internal: false });
async function generate(env, interfaces) {
  let config;
  const context = {
    process: { env: { DOMAIN: 'test.example.com', AUTH: 'test-token', ...env } },
    console: { log() {} },
    require: id => id === 'os' ? { networkInterfaces: () => interfaces }
      : id === 'fs' ? { existsSync: () => true, writeFileSync: (_, text) => { config = JSON.parse(text); } }
      : id === 'axios' ? {} : require(id)
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  await vm.runInContext('generateConfig()', context);
  return config;
}
(async () => {
  const privateNetwork = { eth0: [address('10.10.0.12')] };
  for (const env of [{}, { IPS: '', PORTS: '' }, { IPS: ' ', PORTS: ' ' }]) {
    const c = await generate(env, privateNetwork);
    assert.equal(c.inbounds[0].port, 8001);
    assert.ok(c.outbounds.every(x => !x.sendThrough));
  }
  const portOnly = await generate({ PORTS: '8101' }, privateNetwork);
  assert.equal(portOnly.inbounds[0].port, 8101);
  const manyPorts = await generate({ DOMAINS: 'a.example.com,b.example.com', PORTS: '8101,8102,8103' }, privateNetwork);
  assert.equal(manyPorts.inbounds[0].port, 8101);
  assert.equal(manyPorts.inbounds.length, 5);
  assert.equal(manyPorts.routing.rules.length, 1);
  const explicit = await generate({ IPS: '10.10.0.12', PORTS: '8101' }, privateNetwork);
  assert.equal(explicit.outbounds[0].sendThrough, '10.10.0.12');
  const publicSingle = await generate({}, { eth0: [address('8.8.8.8')] });
  assert.ok(!publicSingle.outbounds[0].sendThrough);
  const multi = await generate({ IPS: '172.18.30.33,172.18.30.34', PORTS: '8001,8002' }, {
    eth0: [address('172.18.30.33')], eth1: [address('172.18.30.34')]
  });
  assert.equal(multi.outbounds[1].sendThrough, '172.18.30.34');
  assert.equal(multi.routing.rules[1].inboundTag.length, 5);
  await assert.rejects(generate({ IPS: '172.18.30.33' }, privateNetwork), /network_mode: host/);
  const legacy = await generate({ MULTI_IP_MODE: 'false', PORTS: '8101' }, privateNetwork);
  assert.equal(legacy.inbounds[0].port, 8101);
  assert.ok(!legacy.routing);
  console.log('通过：未配置、空值、空白、单端口、单源地址、单公网、多出口、错误绑定、旧模式兼容测试');
})().catch(error => { console.error(error); process.exitCode = 1; });
