/**
 * All app audio, synthesized with the Web Audio API — no sound files to
 * host or load. Every sound fires from a user tap, which satisfies
 * browser autoplay rules (the AudioContext is created/resumed on first
 * use). A kiosk-wide mute toggle persists in localStorage.
 */

const MUTE_KEY = 'reward-chart-muted';

let ctx = null;

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function isMuted() {
  return localStorage.getItem(MUTE_KEY) === '1';
}

export function setMuted(muted) {
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
}

/** One enveloped oscillator note. Times are relative to "now". */
function tone(c, { freq, endFreq, start = 0, dur = 0.2, type = 'triangle', gain = 0.18 }) {
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** A filtered white-noise burst (crowd swell, egg crack, whoosh). */
function noiseBurst(c, { start = 0, dur = 0.3, gain = 0.12, freq = 1200, q = 0.8, rise = 0.05 }) {
  const t0 = c.currentTime + start;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur) + 1, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + rise);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

const SOUNDS = {
  /** Soccer celebration: ref whistle + rising fanfare + crowd swell. */
  goal(c) {
    tone(c, { freq: 2100, endFreq: 1900, dur: 0.16, type: 'square', gain: 0.07 }); // whistle
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((freq, i) => tone(c, { freq, start: 0.14 + i * 0.09, dur: 0.22, type: 'triangle', gain: 0.2 }));
    noiseBurst(c, { start: 0.2, dur: 0.7, gain: 0.06, freq: 900, q: 0.4, rise: 0.25 }); // crowd
  },

  /** Dino celebration: egg-crack pop + friendly roar growl + happy chirp. */
  roar(c) {
    noiseBurst(c, { start: 0, dur: 0.12, gain: 0.18, freq: 2400, q: 1.2, rise: 0.01 }); // crack!
    tone(c, { freq: 110, endFreq: 55, start: 0.1, dur: 0.5, type: 'sawtooth', gain: 0.22 }); // roar
    tone(c, { freq: 165, endFreq: 82, start: 0.12, dur: 0.45, type: 'square', gain: 0.08 });
    tone(c, { freq: 620, endFreq: 950, start: 0.62, dur: 0.18, type: 'triangle', gain: 0.16 }); // chirp up
  },

  /** Space celebration: rumble + rising launch whoosh + arrival ding. */
  blastoff(c) {
    tone(c, { freq: 70, endFreq: 45, dur: 0.5, type: 'sawtooth', gain: 0.16 }); // engine rumble
    noiseBurst(c, { start: 0.05, dur: 0.8, gain: 0.12, freq: 700, q: 0.5, rise: 0.35 }); // whoosh
    tone(c, { freq: 220, endFreq: 990, start: 0.15, dur: 0.65, type: 'triangle', gain: 0.14 }); // liftoff
    tone(c, { freq: 1568, start: 0.85, dur: 0.3, type: 'sine', gain: 0.16 }); // in orbit!
  },

  /** Fantasy celebration: harp-like upward gliss + twinkle. */
  magic(c) {
    const notes = [523, 659, 784, 988, 1175, 1568]; // C5 E5 G5 B5 D6 G6
    notes.forEach((freq, i) => tone(c, { freq, start: i * 0.08, dur: 0.4, type: 'sine', gain: 0.15 }));
    tone(c, { freq: 2093, start: 0.55, dur: 0.4, type: 'sine', gain: 0.1 }); // twinkle
    noiseBurst(c, { start: 0.5, dur: 0.35, gain: 0.05, freq: 5000, q: 1.5, rise: 0.05 });
  },

  /** Racing celebration: engine rev + gear shift + victory beeps. */
  vroom(c) {
    tone(c, { freq: 60, endFreq: 190, dur: 0.4, type: 'sawtooth', gain: 0.2 }); // rev up
    tone(c, { freq: 90, endFreq: 240, start: 0.42, dur: 0.3, type: 'sawtooth', gain: 0.18 }); // shift
    noiseBurst(c, { start: 0.1, dur: 0.55, gain: 0.07, freq: 1800, q: 0.6, rise: 0.1 });
    tone(c, { freq: 880, start: 0.8, dur: 0.12, type: 'square', gain: 0.12 }); // victory beeps
    tone(c, { freq: 1109, start: 0.95, dur: 0.25, type: 'square', gain: 0.12 });
  },

  /** Ocean celebration: a breaking wave, a gull, and the ship's bell. */
  wave(c) {
    // Filtered noise swelling and falling is what reads as surf.
    noiseBurst(c, { start: 0, dur: 0.9, gain: 0.12, freq: 600, q: 0.4, rise: 0.35 });
    noiseBurst(c, { start: 0.45, dur: 0.6, gain: 0.06, freq: 1600, q: 0.5, rise: 0.2 }); // foam
    tone(c, { freq: 1200, endFreq: 1600, start: 0.5, dur: 0.14, type: 'sine', gain: 0.07 }); // gull
    tone(c, { freq: 1046, start: 0.85, dur: 0.5, type: 'sine', gain: 0.16 }); // ship's bell (C6)
    tone(c, { freq: 1568, start: 0.88, dur: 0.45, type: 'sine', gain: 0.09 });
  },

  /** Mystery reveal: shimmering magic arpeggio. */
  sparkle(c) {
    const notes = [880, 1109, 1319, 1760, 2217]; // A5 C#6 E6 A6 C#7
    notes.forEach((freq, i) => tone(c, { freq, start: i * 0.07, dur: 0.3, type: 'sine', gain: 0.14 }));
    noiseBurst(c, { start: 0.3, dur: 0.25, gain: 0.05, freq: 4000, q: 1.5, rise: 0.05 });
  },

  /** Reward request sent: cheerful two-note ding. */
  ding(c) {
    tone(c, { freq: 1319, dur: 0.18, type: 'sine', gain: 0.18 }); // E6
    tone(c, { freq: 1568, start: 0.12, dur: 0.35, type: 'sine', gain: 0.18 }); // G6
  },

  /** Secret code correct: quick unlock gliss. */
  unlock(c) {
    tone(c, { freq: 440, endFreq: 880, dur: 0.18, type: 'triangle', gain: 0.16 });
    tone(c, { freq: 1109, start: 0.16, dur: 0.22, type: 'sine', gain: 0.16 });
  },

  /** Secret code wrong: gentle bonk — silly, not scary. */
  bonk(c) {
    tone(c, { freq: 180, endFreq: 90, dur: 0.25, type: 'square', gain: 0.14 });
  },

  /** Whole day done (egg hatched / full time): big fanfare. */
  fanfare(c) {
    const seq = [523, 523, 659, 784, 1047, 784, 1047]; // C C E G C' G C'
    const starts = [0, 0.12, 0.24, 0.36, 0.52, 0.72, 0.88];
    seq.forEach((freq, i) =>
      tone(c, { freq, start: starts[i], dur: i >= 5 ? 0.45 : 0.2, type: 'triangle', gain: 0.2 })
    );
    seq.forEach((freq, i) =>
      tone(c, { freq: freq / 2, start: starts[i], dur: i >= 5 ? 0.45 : 0.2, type: 'square', gain: 0.06 })
    );
    noiseBurst(c, { start: 0.5, dur: 0.9, gain: 0.06, freq: 1500, q: 0.4, rise: 0.3 });
  },
};

export function playSound(name) {
  if (isMuted()) return;
  try {
    const c = getCtx();
    if (!c) return;
    SOUNDS[name]?.(c);
  } catch {
    /* audio is never worth crashing the kiosk over */
  }
}
