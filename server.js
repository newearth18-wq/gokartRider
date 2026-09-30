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
const VALID_CHARACTERS = new Set(['nova', 'poppy', 'riko', 'momo', 'luna', 'mint', 'bibi', 'pixel', 'koko', 'sol']);
const VALID_MODELS = new Set(['comet', 'rocket', 'grip', 'flash', 'bubble', 'shark', 'hover']);
const VALID_ITEMS = new Set(['pulse', 'shield', 'nitro', 'banana', 'ball', 'pie']);
const VALID_HITS = new Set(['banana', 'ball', 'pie', 'pulse']);
const ROOT = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const rooms = new Map();
let nextPlayer = 1;
let resolveKartCollision;

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
  const active = [...room.players.values()].map(({ id, name, character, model, kart, helmet, rim, decal, distance, lateral, speed, boost, shield, held, hitKind, hitTime, hitId, bumpId, finishedAt, finishPlace, finishTime, quizCorrect, quizAttempted }) =>
    ({ id, name, character, model, kart, helmet, rim, decal, distance, lateral, speed, boost, shield, held, hitKind, hitTime, hitId, bumpId, finishedAt, finishPlace, finishTime, quizCorrect, quizAttempted }));
  return active.concat([...room.results.values()].filter(player => !room.players.has(player.id)));
}

function roomStatus(room) {
  return { type: 'room', code: room.code, track: room.track, mode: room.mode,
    learning: room.learning, questions: room.learning ? room.questions : [],
    state: room.state, hostId: room.hostId, maxPlayers: MAX_PLAYERS,
    startAt: room.startAt, players: publicPlayers(room) };
}

function cleanQuestions(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20 ||
      Buffer.byteLength(JSON.stringify(input)) > 9000) return null;
  const questions = [];
  for (const item of input) {
    if (typeof item?.question !== 'string' || !item.question.trim() || item.question.length > 120 ||
        !Array.isArray(item.options) || item.options.length !== 4 ||
        item.options.some(option => typeof option !== 'string' || !option.trim() || option.length > 80) ||
        !Number.isInteger(item.answer) || item.answer < 0 || item.answer > 3) return null;
    questions.push({ question: item.question.trim(), options: item.options.map(option => option.trim()), answer: item.answer });
  }
  return questions;
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
    const questions = message.learning ? cleanQuestions(message.questions) : [];
    if (message.learning && !questions) return send(client, { type: 'error', message: 'ชุดข้อสอบไม่ถูกต้องหรือใหญ่เกิน 9 KB' });
    room = { code, track: VALID_TRACKS.has(message.track) ? message.track : 'meadow',
      mode: message.mode === 'item' ? 'item' : 'speed', state: 'lobby',
      learning: Boolean(message.learning), questions,
      hostId: client.id, players: new Map(), results: new Map(), startAt: 0, createdAt: Date.now() };
    rooms.set(code, room);
  }
  client.name = cleanName(message.name);
  client.character = VALID_CHARACTERS.has(message.character) ? message.character : 'nova';
  client.model = VALID_MODELS.has(message.model) ? message.model : 'comet';
  client.kart = /^#[0-9a-fA-F]{6}$/.test(message.kart || '') ? message.kart : '#258def';
  client.helmet = /^#[0-9a-fA-F]{6}$/.test(message.helmet || '') ? message.helmet : '#258def';
  client.rim = /^#[0-9a-fA-F]{6}$/.test(message.rim || '') ? message.rim : '#e3edf6';
  client.decal = ['bolt', 'stripe', 'star', 'plain'].includes(message.decal) ? message.decal : 'bolt';
  const slot = room.players.size;
  client.distance = -Math.floor(slot / 4) * 6.5;
  client.lateral = [-6, -2, 2, 6][slot % 4];
  client.speed = 0;
  client.boost = client.shield = false;
  client.held = null;
  client.hitKind = null;
  client.hitTime = client.hitId = 0;
  client.bumpId = 0;
  client.lastBumpAt = 0;
  client.lastBumpWith = null;
  client.finishedAt = null;
  client.finishPlace = client.finishTime = null;
  client.quizCorrect = client.quizAttempted = 0;
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
  if (message.type === 'state' && !client.finishedAt &&
      (room.state === 'racing' || room.state === 'countdown')) {
    const distance = Number(message.distance), lateral = Number(message.lateral), speed = Number(message.speed);
    if (![distance, lateral, speed].every(Number.isFinite)) return;
    const elapsed = Math.max(0, (Date.now() - room.startAt) / 1000);
    // A loose sanity bound blocks arbitrary leaderboard jumps without impacting boosts.
    const maxDistance = elapsed * 100 + 60;
    const previous = { distance: client.distance, lateral: client.lateral };
    let proposed = {
      distance: Math.min(Math.max(client.distance - 2, distance), maxDistance),
      lateral: Math.max(-15.15, Math.min(15.15, lateral)),
      speed: Math.max(0, Math.min(105, speed)),
      lateralVelocity: 0,
    };
    let collision = null;
    if (room.state === 'racing') {
      for (const rival of room.players.values()) {
        if (rival.id === client.id || rival.finishedAt) continue;
        const resolved = resolveKartCollision(previous, proposed, rival);
        if (!resolved) continue;
        proposed = resolved;
        collision = { ...resolved, otherId: rival.id };
      }
    }
    client.distance = proposed.distance;
    client.lateral = proposed.lateral;
    client.speed = proposed.speed;
    if (collision) {
      const now = Date.now();
      if (collision.impact > 6 &&
          (client.lastBumpWith !== collision.otherId || now - client.lastBumpAt > 720)) {
        client.bumpId++;
        client.lastBumpAt = now;
        client.lastBumpWith = collision.otherId;
      }
      send(client, { type: 'collision', distance: client.distance, lateral: client.lateral,
        speed: client.speed, axis: collision.axis, impact: collision.impact,
        otherId: collision.otherId, bumpId: client.bumpId });
    }
    client.boost = Boolean(message.boost);
    client.shield = Boolean(message.shield);
    client.held = VALID_ITEMS.has(message.held) ? message.held : null;
    client.hitKind = VALID_HITS.has(message.hitKind) && Number(message.hitTime) > 0 ? message.hitKind : null;
    client.hitTime = client.hitKind ? Math.max(0, Math.min(3, Number(message.hitTime) || 0)) : 0;
    client.hitId = Number.isSafeInteger(message.hitId) && message.hitId >= 0 ? message.hitId : 0;
    return;
  }
  if (message.type === 'item' && (room.mode === 'item' || room.learning) && room.state === 'racing') {
    if (!VALID_ITEMS.has(message.item)) return;
    if (Date.now() - (client.lastItemAt || 0) < 1000) return;
    client.lastItemAt = Date.now();
    const event = { type: 'item', id: client.id, item: message.item };
    if (message.item === 'banana') {
      event.distance = client.distance - 6;
      event.lateral = client.lateral;
    } else if (message.item === 'ball' || message.item === 'pie') {
      const rivals = [...room.players.values()].filter(player => player.id !== client.id && !player.finishedAt &&
        Math.abs(player.distance - client.distance) <= 180);
      rivals.sort((a, b) => {
        const aGap = a.distance - client.distance, bGap = b.distance - client.distance;
        return (aGap >= -6 ? 0 : 1) - (bGap >= -6 ? 0 : 1) || Math.abs(aGap) - Math.abs(bGap);
      });
      event.targetId = rivals[0]?.id || null;
      event.fromDistance = client.distance;
      event.fromLateral = client.lateral;
      event.toDistance = rivals[0]?.distance ?? client.distance + 65;
      event.toLateral = rivals[0]?.lateral ?? client.lateral;
    }
    broadcast(room, event);
    return;
  }
  if (message.type === 'finish' && room.state === 'racing' && !client.finishedAt) {
    client.finishedAt = Date.now();
    client.finishPlace = room.results.size + 1;
    client.finishTime = Math.max(0, client.finishedAt - room.startAt);
    client.quizAttempted = Number.isInteger(message.quizAttempted) ?
      Math.max(0, Math.min(100, message.quizAttempted)) : 0;
    client.quizCorrect = Number.isInteger(message.quizCorrect) ?
      Math.max(0, Math.min(client.quizAttempted, message.quizCorrect)) : 0;
    room.results.set(client.id, publicPlayers(room).find(player => player.id === client.id));
    broadcast(room, { type: 'finish', id: client.id, place: client.finishPlace,
      finishTime: client.finishTime, quizCorrect: client.quizCorrect,
      quizAttempted: client.quizAttempted });
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
  if (!file.startsWith(ROOT + path.sep) || !['.html', '.js', '.mjs', '.css', '.json', '.svg', '.png'].includes(path.extname(file))) {
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

import('./collision.mjs').then(module => {
  resolveKartCollision = module.resolveKartCollision;
  server.listen(PORT, HOST, () => console.log(`Turbo Trail listening on ${HOST}:${PORT}`));
});
