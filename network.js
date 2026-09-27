// Set after the relay is deployed. Local development connects to its own origin.
const PUBLIC_RELAY = 'wss://turbo-trail-online.onrender.com/race';
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
export const RELAY_URL = local ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/race` : PUBLIC_RELAY;

export class RaceConnection {
  constructor(onMessage, onClose) {
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.ws = null;
    this.id = null;
    this.room = null;
  }

  connect(action, options) {
    this.close();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(RELAY_URL);
      this.ws = ws;
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; ws.close(); reject(new Error('เซิร์ฟเวอร์ยังไม่ตอบสนอง ลองอีกครั้ง')); }
      }, 20000);
      ws.addEventListener('open', () => ws.send(JSON.stringify({ type: action, ...options })));
      ws.addEventListener('message', event => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'welcome') {
          this.id = data.id;
          this.room = data.code;
          if (!settled) { settled = true; clearTimeout(timer); resolve(data); }
        } else if (data.type === 'error' && !settled) {
          settled = true; clearTimeout(timer); ws.close(); reject(new Error(data.message));
        }
        this.onMessage(data);
      });
      ws.addEventListener('close', () => {
        clearTimeout(timer);
        if (!settled) { settled = true; reject(new Error('เชื่อมต่อห้องแข่งไม่ได้')); }
        if (this.ws === ws) { this.ws = null; this.room = null; this.onClose(); }
      });
      ws.addEventListener('error', () => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')); }
      });
    });
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data));
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.id = null;
    this.room = null;
  }
}
