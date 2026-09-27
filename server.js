// Zero-dependency HTTP and WebSocket server for Turbo Trail rooms.
// Run with `node server.js`; one process holds the live race rooms in memory.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PLAYERS = 50;
const VALID_TRACKS = new Set(['meadow', 'canyon', 'snow', 'harbor']);
const VALID_CHARACTERS = new Set(['nova', 'poppy', 'riko', 'momo', 'luna', 'mint']);
const ROOT = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const rooms = new Map();
let nextPlayer = 1;

function cleanName(value) {
  return String(value || 'Rider').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 18) || 'Rider';
}

function send(client, message) {
  if (client.socket.destroyed) return;
  const body = Buffer.from(JSON.stringify(message));
  const header = body.length < 126 ? Buffer.from([0x81, body.length]) :
    Buffer.from([0x81, 126, body.length >>> 8, body.length & 255]);
  // Slow connections are dropped so a single client cannot stall a 50-rider room.
  if (client.socket.writableLength > 512_000) return client.socket.destroy();
  client.socket.write(Buffer.concat([header, body]));
}

function broadcast(room, message) {
  for (const client of room.players.values()) send(client, message);
}

function publicPlayers(room) {
  return [...room.players.values()].map(({ id, name, character, kart, helmet, rim, decal, distance, lateral, speed, boost, shield, finishedAt }) =>
    ({ id, name, character, kart, helmet, rim, decal, distance, lateral, speed, boost, shield, finishedAt }));
}

function roomStatus(room) {
  return { type: 'room', code: room.code, track: room.track, mode: room.mode,
    state: room.state, hostId: room.hostId, maxPlayers: MAX_PLAYERS,
    startAt: room.startAt, players: publicPlayers(room) };
}

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from(crypto.randomBytes(5), b => alphabet[b % alphabet.length]).join(''); }
  while (rooms.has(code));
  return code;
}

function leave(client) {
  const room = client.room;
  if (!room) return;
  room.players.delete(client.id);
  client.room = null;
  if (room.players.size === 0) return rooms.delete(room.code);
  if (room.hostId === client.id) room.hostId = room.players.keys().next().value;
  broadcast(room, roomStatus(room));
}

function join(client, message) {
  if (client.room) return send(client, { type: 'error', message: 'อยู่ในห้องแล้ว' });
  const creating = message.type === 'create';
  const code = creating ? newCode() : String(message.code || '').trim().toUpperCase();
  let room = creating ? null : rooms.get(code);
  if (!creating && !room) return send(client, { type: 'error', message: 'ไม่พบรหัสห้องนี้' });
  if (room && room.state !== 'lobby') return send(client, { type: 'error', message: 'การแข่งขันเริ่มไปแล้ว' });
  if (room && room.players.size >= MAX_PLAYERS) return send(client, { type: 'error', message: 'ห้องเต็ม 50 คนแล้ว' });
  if (creating) {
    room = { code, track: VALID_TRACKS.has(message.track) ? message.track : 'meadow',
      mode: message.mode === 'item' ? 'item' : 'speed', state: 'lobby',
      hostId: client.id, players: new Map(), startAt: 0, createdAt: Date.now() };
    rooms.set(code, room);
  }
  client.name = cleanName(message.name);
  client.character = VALID_CHARACTERS.has(message.character) ? message.character : 'nova';
  client.kart = /^#[0-9a-fA-F]{6}$/.test(message.kart || '') ? message.kart : '#258def';
  client.helmet = /^#[0-9a-fA-F]{6}$/.test(message.helmet || '') ? message.helmet : '#258def';
  client.rim = /^#[0-9a-fA-F]{6}$/.test(message.rim || '') ? message.rim : '#e3edf6';
  client.decal = ['bolt', 'stripe', 'star', 'plain'].includes(message.decal) ? message.decal : 'bolt';
  const slot = room.players.size;
  client.distance = -Math.floor(slot / 4) * 4;
  client.lateral = [-6, -2, 2, 6][slot % 4];
  client.speed = 0;
  client.boost = client.shield = false;
  client.finishedAt = null;
  client.room = room;
  room.players.set(client.id, client);
  send(client, { ...roomStatus(room), type: 'welcome', id: client.id });
  broadcast(room, roomStatus(room));
}

function handleMessage(client, message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'create' || message.type === 'join') return join(client, message);
  const room = client.room;
  if (!room) return;
  if (message.type === 'leave') return leave(client);
  if (message.type === 'start' && room.hostId === client.id && room.state === 'lobby') {
    room.state = 'countdown';
    room.startAt = Date.now() + 3500;
    broadcast(room, roomStatus(room));
    return;
  }
  if (message.type === 'state' && (room.state === 'racing' || room.state === 'countdown')) {
    const distance = Number(message.distance), lateral = Number(message.lateral), speed = Number(message.speed);
    if (![distance, lateral, speed].every(Number.isFinite)) return;
    const elapsed = Math.max(0, (Date.now() - room.startAt) / 1000);
    // A loose sanity bound blocks arbitrary leaderboard jumps without impacting boosts.
    const maxDistance = elapsed * 100 + 60;
    client.distance = Math.min(Math.max(client.distance - 2, distance), maxDistance);
    client.lateral = Math.max(-11, Math.min(11, lateral));
    client.speed = Math.max(0, Math.min(90, speed));
    client.boost = Boolean(message.boost);
    client.shield = Boolean(message.shield);
    return;
  }
  if (message.type === 'item' && room.mode === 'item' && room.state === 'racing') {
    if (!['pulse', 'shield', 'nitro'].includes(message.item)) return;
    if (Date.now() - (client.lastItemAt || 0) < 4000) return;
    client.lastItemAt = Date.now();
    broadcast(room, { type: 'item', id: client.id, item: message.item });
    return;
  }
  if (message.type === 'finish' && room.state === 'racing' && !client.finishedAt) {
    client.finishedAt = Date.now();
    broadcast(room, { type: 'finish', id: client.id, place: [...room.players.values()]
      .filter(player => player.finishedAt).length });
  }
}

function frame(opcode, body = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([0x80 | opcode, body.length]), body]);
}

function onData(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  if (client.buffer.length > 64_000) return client.socket.destroy();
  while (client.buffer.length >= 2) {
    const first = client.buffer[0], second = client.buffer[1];
    const opcode = first & 15;
    if (!(first & 0x80) || !(second & 0x80)) return client.socket.destroy();
    let size = second & 127, offset = 2;
    if (size === 126) {
      if (client.buffer.length < 4) return;
      size = client.buffer.readUInt16BE(2); offset = 4;
    } else if (size === 127) return client.socket.destroy();
    if (size > 16_384) return client.socket.destroy();
    if (client.buffer.length < offset + 4 + size) return;
    const mask = client.buffer.subarray(offset, offset + 4);
    const body = Buffer.from(client.buffer.subarray(offset + 4, offset + 4 + size));
    client.buffer = client.buffer.subarray(offset + 4 + size);
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
    if (opcode === 8) return client.socket.end(frame(8));
    if (opcode === 9) { client.socket.write(frame(10, body)); continue; }
    if (opcode !== 1) continue;
    try { handleMessage(client, JSON.parse(body.toString('utf8'))); }
    catch { send(client, { type: 'error', message: 'ข้อมูลไม่ถูกต้อง' }); }
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return response.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((n, room) => n + room.players.size, 0) }));
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { response.writeHead(400); return response.end(); }
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(ROOT, '.' + pathname);
  if (!file.startsWith(ROOT + path.sep) || !['.html', '.js', '.css', '.json', '.svg', '.png'].includes(path.extname(file))) {
    response.writeHead(404); return response.end('Not found');
  }
  fs.createReadStream(file).on('error', () => { if (!response.headersSent) response.writeHead(404); response.end('Not found'); })
    .on('open', () => response.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }))
    .pipe(response);
});

server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/race' || request.headers.upgrade?.toLowerCase() !== 'websocket' ||
      !/^[-+/0-9A-Za-z]{22}==$/.test(request.headers['sec-websocket-key'] || '')) return socket.destroy();
  const accept = crypto.createHash('sha1').update(request.headers['sec-websocket-key'] +
    '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const client = { id: String(nextPlayer++), socket, buffer: Buffer.alloc(0), room: null, lastSeen: Date.now() };
  socket.on('data', chunk => { client.lastSeen = Date.now(); onData(client, chunk); });
  socket.on('close', () => leave(client));
  socket.on('error', () => leave(client));
  if (head.length) onData(client, head);
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.state === 'countdown' && now >= room.startAt) room.state = 'racing';
    if (room.state === 'racing') broadcast(room, { type: 'snapshot', at: now,
      players: publicPlayers(room) });
    if (now - room.createdAt > 2 * 60 * 60 * 1000) {
      for (const client of room.players.values()) client.socket.destroy();
      rooms.delete(room.code);
    }
  }
}, 100);

server.listen(PORT, HOST, () => console.log(`Turbo Trail listening on ${HOST}:${PORT}`));
