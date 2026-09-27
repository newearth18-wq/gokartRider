export class GameAudio {
  constructor() {
    this.context = null;
    this.engine = null;
    this.engineGain = null;
    try { this.enabled = localStorage.getItem('turbo-trail-muted') !== 'true'; }
    catch { this.enabled = true; }
  }

  start() {
    if (!this.enabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!this.context) {
      this.context = new AudioContext();
      this.engine = this.context.createOscillator();
      this.engine.type = 'sawtooth';
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 230;
      this.engineGain = this.context.createGain();
      this.engineGain.gain.value = 0;
      this.engine.connect(filter).connect(this.engineGain).connect(this.context.destination);
      this.engine.start();
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('turbo-trail-muted', String(!this.enabled)); } catch {}
    if (this.enabled) this.start();
    else if (this.engineGain && this.context) this.engineGain.gain.setTargetAtTime(0, this.context.currentTime, .04);
    return this.enabled;
  }

  update(speed, racing, boosting) {
    if (!this.context || !this.engine) return;
    const now = this.context.currentTime;
    this.engine.frequency.setTargetAtTime(48 + Math.min(speed, 85) * 2.1 + (boosting ? 45 : 0), now, .08);
    this.engineGain.gain.setTargetAtTime(this.enabled && racing ? .012 + Math.min(speed, 85) * .00032 : 0, now, .06);
  }

  cue(kind) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    const notes = {
      tick: [[660, .07]], go: [[520, .10], [780, .16]],
      boost: [[440, .08], [660, .10], [980, .20]],
      correct: [[580, .09], [780, .11], [1040, .20]],
      wrong: [[280, .13], [220, .18]], finish: [[520, .10], [660, .10], [820, .10], [1040, .28]],
    }[kind];
    if (!notes) return;
    let at = now;
    for (const [frequency, duration] of notes) {
      const tone = this.context.createOscillator();
      const gain = this.context.createGain();
      tone.type = kind === 'wrong' ? 'triangle' : 'sine';
      tone.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(.075, at + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      tone.connect(gain).connect(this.context.destination);
      tone.start(at);
      tone.stop(at + duration + .01);
      at += duration * .82;
    }
  }
}
