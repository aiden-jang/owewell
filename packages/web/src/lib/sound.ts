/*
 * UI sound, synthesized on the fly.
 *
 * No audio files: the whole palette is a table of oscillator envelopes, a few hundred bytes of code
 * where samples would be a few hundred kilobytes to serve and cache.
 *
 * Everything is built from a C major pentatonic scale, which has no semitones, so overlapping cues
 * can't clash however they land. The palette is deliberately quieter and rounder than a game's: this
 * app gets used at a table while people are settling up, and money should sound like a well-made
 * calculator rather than a slot machine.
 *
 * The engine below (mute, priming, lookahead, the repeat guard, `play`) is intentionally identical
 * to the one in wherever. Only the cue table and the storage key differ, so if these ever move into
 * a shared package it's a lift rather than a merge.
 */

const MUTE_KEY = 'owewell.muted.v1';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

/** Returns the new state. Unmuting plays a short confirmation so the toggle proves itself. */
export function toggleMuted(): boolean {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* private mode; the setting just won't survive a reload */
  }
  if (!muted) play('settled');
  return muted;
}

function graph(): { ctx: AudioContext; master: GainNode } | null {
  if (muted) return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = 0.45;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return master ? { ctx, master } : null;
}

/**
 * Build the graph on the first gesture anywhere.
 *
 * Someone else adding an expense arrives over the socket, not from a tap, and iOS only resumes an
 * audio context inside a gesture. Without this the cue that tells you the group moved is the one
 * that gets dropped.
 */
export function primeOnFirstGesture(): void {
  const events = ['pointerdown', 'keydown', 'touchstart'] as const;
  const prime = (): void => {
    for (const e of events) window.removeEventListener(e, prime);
    graph();
  };
  for (const e of events) window.addEventListener(e, prime, { passive: true });
}

/** Semitones from A440, so cue definitions read as intervals rather than magic frequencies. */
function hz(semitones: number): number {
  return 440 * Math.pow(2, semitones / 12);
}

const C4 = hz(-9);
const G4 = hz(-2);
const C5 = hz(3);
const D5 = hz(5);
const E5 = hz(7);
const G5 = hz(10);
const A5 = hz(12);
const C6 = hz(15);

interface Voice {
  freq: number;
  /** Seconds after the cue starts. */
  at?: number;
  dur?: number;
  gain?: number;
  type?: OscillatorType;
}

const CUES: Record<string, Voice[]> = {
  /* Adding a line. Short and unmusical enough to fire twenty times without becoming a tune. */
  tick: [{ freq: A5, dur: 0.04, gain: 0.07, type: 'sine' }],

  /* An expense saved: up a fourth, which reads as "logged" rather than "finished". */
  add: [
    { freq: G5, dur: 0.06, gain: 0.09, type: 'triangle' },
    { freq: C6, at: 0.05, dur: 0.11, gain: 0.09, type: 'triangle' },
  ],

  /*
   * One debt cleared. A rising fourth over a low root: the interval that sounds resolved rather than
   * merely finished, which is the difference between "paid" and "over with".
   */
  settled: [
    { freq: G5, dur: 0.1, gain: 0.11, type: 'triangle' },
    { freq: C6, at: 0.08, dur: 0.28, gain: 0.12, type: 'triangle' },
    { freq: C4, at: 0.02, dur: 0.36, gain: 0.06, type: 'sine' },
  ],

  /* Nobody owes anybody. The only cue in the app that gets to be a full chord. */
  allSettled: [
    { freq: C5, dur: 0.12, gain: 0.1, type: 'triangle' },
    { freq: E5, at: 0.07, dur: 0.12, gain: 0.1, type: 'triangle' },
    { freq: G5, at: 0.14, dur: 0.14, gain: 0.1, type: 'triangle' },
    { freq: C6, at: 0.21, dur: 0.45, gain: 0.11, type: 'triangle' },
    { freq: E5, at: 0.21, dur: 0.5, gain: 0.05, type: 'sine' },
  ],

  /* Undo: the settled cue backwards, so the mistake sounds like the mistake it was. */
  undo: [
    { freq: C6, dur: 0.08, gain: 0.08, type: 'triangle' },
    { freq: G4, at: 0.07, dur: 0.2, gain: 0.08, type: 'triangle' },
  ],

  /* A quick split resolving. Brisk, three notes, no ceremony: it's arithmetic, not an achievement. */
  verdict: [
    { freq: C5, dur: 0.07, gain: 0.09, type: 'triangle' },
    { freq: G5, at: 0.06, dur: 0.07, gain: 0.09, type: 'triangle' },
    { freq: C6, at: 0.12, dur: 0.2, gain: 0.1, type: 'triangle' },
  ],

  /*
   * Someone else changed the group while you were looking at it. Low and quiet on purpose: this one
   * fires without you doing anything, so it has to read as peripheral or it becomes a nuisance.
   */
  nudge: [
    { freq: D5, dur: 0.05, gain: 0.05, type: 'sine' },
    { freq: G4, at: 0.05, dur: 0.12, gain: 0.05, type: 'sine' },
  ],
};

export type Cue = keyof typeof CUES;

/*
 * A held key or a double-tap retriggers the same cue inside a few milliseconds, which stacks
 * identical oscillators into a buzz. The repeat is dropped rather than layered.
 */
const MIN_GAP_SECONDS = 0.05;
const lastPlayed = new Map<string, number>();

/*
 * Schedule slightly ahead of now, never at now.
 *
 * The audio thread has already rendered up to currentTime by the time this runs, so a note booked
 * for exactly currentTime lands in the past and the hardware skips what it missed. That doesn't
 * silence the cue, which is why it's easy to miss: it eats the attack and leaves the tail.
 */
const LOOKAHEAD_SECONDS = 0.02;

export function play(cue: Cue): void {
  const g = graph();
  if (!g) return;
  const voices = CUES[cue];
  if (!voices) return;

  const now = g.ctx.currentTime + LOOKAHEAD_SECONDS;
  if (now - (lastPlayed.get(cue) ?? -Infinity) < MIN_GAP_SECONDS) return;
  lastPlayed.set(cue, now);

  for (const v of voices) {
    const start = now + (v.at ?? 0);
    const dur = v.dur ?? 0.1;
    const peak = v.gain ?? 0.1;

    const osc = g.ctx.createOscillator();
    osc.type = v.type ?? 'triangle';
    osc.frequency.setValueAtTime(v.freq, start);

    // A 6ms fade in and an exponential tail. Starting or ending a note at full amplitude puts a step
    // in the waveform, which the speaker reproduces as an audible click over the note itself.
    const env = g.ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    osc.connect(env);
    env.connect(g.master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }
}
