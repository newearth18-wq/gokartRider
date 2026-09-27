const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

function availablePort() {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function waitMessage(ws, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.removeEventListener('message', onMessage); reject(new Error('Timed out waiting for message')); }, timeout);
    function onMessage(event) {
      const data = JSON.parse(event.data);
      if (!predicate(data)) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      resolve(data);
    }
    ws.addEventListener('message', onMessage);
  });
}

async function open(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return ws;
}

test('50 riders share a room and the 51st is rejected', { timeout: 30000 }, async () => {
  const port = await availablePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore',
  });
  const clients = [];
  try {
    let healthy = false;
    for (let i = 0; i < 50; i++) {
      try { healthy = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()).ok; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 40)); }
    }
    assert.equal(healthy, true, 'server started');
    const url = `ws://127.0.0.1:${port}/race`;
    const host = await open(url); clients.push(host);
    const first = waitMessage(host, data => data.type === 'welcome');
    host.send(JSON.stringify({ type: 'create', name: 'Host', track: 'snow' }));
    const welcome = await first;
    assert.equal(welcome.track, 'snow');
    for (let i = 1; i < 50; i++) {
      const ws = await open(url); clients.push(ws);
      const next = waitMessage(ws, data => data.type === 'welcome');
      ws.send(JSON.stringify({ type: 'join', code: welcome.code, name: `Rider${i}` }));
      const joined = await next;
      assert.equal(joined.code, welcome.code);
    }
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.players, 50);
    const extra = await open(url); clients.push(extra);
    const rejected = waitMessage(extra, data => data.type === 'error');
    extra.send(JSON.stringify({ type: 'join', code: welcome.code, name: 'Extra' }));
    assert.match((await rejected).message, /50/);
    const countdown = waitMessage(clients[49], data => data.type === 'room' && data.state === 'countdown');
    host.send(JSON.stringify({ type: 'start' }));
    assert.equal((await countdown).players.length, 50);
    const spectator = await open(url); clients.push(spectator);
    const late = waitMessage(spectator, data => data.type === 'error');
    spectator.send(JSON.stringify({ type: 'join', code: welcome.code }));
    assert.match((await late).message, /เริ่ม/);
    const live = waitMessage(clients[1], data => data.type === 'snapshot' && data.players.length === 50, 7000);
    assert.equal((await live).players.length, 50);
    const moved = waitMessage(clients[1], data => data.type === 'snapshot' &&
      data.players.some(player => player.id === welcome.id && player.distance >= 24));
    host.send(JSON.stringify({ type: 'state', distance: 24, lateral: 2, speed: 30 }));
    assert.equal((await moved).players.find(player => player.id === welcome.id).lateral, 2);
  } finally {
    for (const client of clients) client.close();
    child.kill();
  }
});
