export class GameAudio {
  constructor() {
    this.context = null;
    this.engine = null;
    this.engineGain = null;
    this.musicGain = null;
    this.nextMusicTime = 0;
    this.musicStep = 0;
    this.noiseBuffer = null;
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
      this.musicGain = this.context.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.context.destination);
      this.noiseBuffer = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * .45),
        this.context.sampleRate);
      const samples = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('turbo-trail-muted', String(!this.enabled)); } catch {}
    if (this.enabled) this.start();
    else if (this.engineGain && this.context) {
      this.engineGain.gain.setTargetAtTime(0, this.context.currentTime, .04);
      this.musicGain.gain.setTargetAtTime(0, this.context.currentTime, .04);
      this.nextMusicTime = 0;
    }
    return this.enabled;
  }

  update(speed, racing, boosting) {
    if (!this.context || !this.engine) return;
    const now = this.context.currentTime;
    this.engine.frequency.setTargetAtTime(48 + Math.min(speed, 85) * 2.1 + (boosting ? 45 : 0), now, .08);
    this.engineGain.gain.setTargetAtTime(this.enabled && racing ? .012 + Math.min(speed, 85) * .00032 : 0, now, .06);
    this.musicGain.gain.setTargetAtTime(this.enabled && racing ? .35 : 0, now, .09);
    if (!this.enabled || !racing || this.context.state !== 'running') {
      this.nextMusicTime = 0;
      return;
    }
    if (!this.nextMusicTime || this.nextMusicTime < now - .4) this.nextMusicTime = now + .02;
    while (this.nextMusicTime < now + .22) {
      this.scheduleMusicStep(this.nextMusicTime, this.musicStep++);
      this.nextMusicTime += .235;
    }
  }

  musicNote(frequency, at, duration, type, volume) {
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    envelope.gain.setValueAtTime(.0001, at);
    envelope.gain.exponentialRampToValueAtTime(volume, at + .015);
    envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
    oscillator.connect(envelope).connect(this.musicGain);
    oscillator.start(at);
    oscillator.stop(at + duration + .02);
  }

  scheduleMusicStep(at, step) {
    // A short original chiptune loop generated locally, without a remote audio file.
    const melody = [659, 0, 784, 880, 784, 659, 587, 0,
      659, 784, 988, 880, 784, 659, 587, 523];
    const note = melody[step % melody.length];
    if (note) this.musicNote(note, at, .17, 'triangle', .075);
    if (step % 2 === 0) this.musicNote(2200, at, .035, 'triangle', .012);
    if (step % 4 === 0) {
      const bass = [131, 110, 146, 98][Math.floor(step / 4) % 4];
      this.musicNote(bass, at, .36, 'sawtooth', .045);
      this.musicNote(64, at, .09, 'sine', .055);
    }
  }

  noiseBurst(at, duration, frequency, volume, filterType = 'lowpass') {
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, at);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(filter).connect(gain).connect(this.context.destination);
    source.start(at);
    source.stop(at + duration + .01);
  }

  sweep(at, from, to, duration, type, volume) {
    const tone = this.context.createOscillator();
    const gain = this.context.createGain();
    tone.type = type;
    tone.frequency.setValueAtTime(from, at);
    tone.frequency.exponentialRampToValueAtTime(to, at + duration);
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    tone.connect(gain).connect(this.context.destination);
    tone.start(at);
    tone.stop(at + duration + .01);
  }

  cue(kind) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    const notes = {
      tick: [[660, .07]], go: [[520, .10], [780, .16]],
      boost: [[440, .08], [660, .10], [980, .20]],
      jump: [[460, .06], [720, .08], [1080, .14]], land: [[180, .07], [100, .13]],
      correct: [[580, .09], [780, .11], [1040, .20]],
      wrong: [[280, .13], [220, .18]], finish: [[520, .10], [660, .10], [820, .10], [1040, .28]],
      shield: [[520, .1], [780, .18]], pulse: [[300, .08], [460, .08], [680, .15]],
      banana: [[540, .08], [380, .12]], ball: [[420, .07], [700, .07], [520, .14]],
      pie: [[660, .07], [440, .08], [290, .14]], hit: [[240, .08], [170, .18]],
      skid: [[780, .06], [540, .07], [330, .12], [510, .12]],
      crash: [[240, .12], [160, .18], [95, .24]],
      stun: [[540, .06], [310, .09], [180, .20]],
      stall: [[620, .05], [280, .10], [115, .21]],
      blocked: [[750, .07], [980, .16]],
      collision: [[260, .08], [130, .16]],
      ballImpact: [[410, .06], [190, .13], [110, .19]],
      pieImpact: [[680, .05], [360, .10], [220, .14]],
      bananaImpact: [[850, .05], [580, .08], [350, .15]],
      pulseImpact: [[900, .04], [470, .12], [160, .20]],
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
    if (kind === 'jump') {
      this.sweep(now, 250, 1100, .32, 'triangle', .06);
    } else if (kind === 'land') {
      this.noiseBurst(now, .14, 360, .055);
    } else if (['collision', 'crash', 'ballImpact'].includes(kind)) {
      this.noiseBurst(now, kind === 'collision' ? .24 : .18, 520, .14);
      this.sweep(now, 190, 72, .23, 'sawtooth', .085);
    } else if (kind === 'pieImpact') {
      this.noiseBurst(now, .15, 1300, .09);
      this.sweep(now, 650, 170, .18, 'triangle', .07);
    } else if (kind === 'bananaImpact') {
      this.noiseBurst(now, .28, 2200, .055, 'highpass');
      this.sweep(now, 1050, 250, .30, 'sine', .07);
    } else if (kind === 'pulseImpact' || kind === 'pulse') {
      this.noiseBurst(now, .15, 3400, .06, 'highpass');
      this.sweep(now, 1300, 95, .35, 'sawtooth', .055);
    } else if (kind === 'ball' || kind === 'pie') {
      this.sweep(now, kind === 'ball' ? 260 : 580, kind === 'ball' ? 820 : 210,
        .25, 'triangle', .065);
    } else if (kind === 'blocked' || kind === 'shield') {
      this.sweep(now, 500, 1500, .20, 'sine', .055);
    }
  }
}
