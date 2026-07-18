import { createMono } from './bufferCreation';
import { SAMPLE_RATE, TWO_PI } from './constants';

import type { MonoBuffer } from './types';

export function renderSine(
    durationSec: number,
    freq: number | ((t: number) => number),
    sampleRate: number = SAMPLE_RATE
): MonoBuffer {
    const out = createMono(durationSec, sampleRate);
    const dt = 1 / sampleRate;
    let phase = 0;
    const isFn = typeof freq === 'function';
    for (let i = 0; i < out.length; i++) {
        const t = i * dt;
        const f = isFn ? freq(t) : freq;
        phase += TWO_PI * f * dt;
        out[i] = Math.sin(phase);
    }
    return out;
}

export function renderTriangle(
    durationSec: number,
    freq: number | ((t: number) => number),
    sampleRate: number = SAMPLE_RATE
): MonoBuffer {
    const out = createMono(durationSec, sampleRate);
    const dt = 1 / sampleRate;
    let phase = 0;
    const isFn = typeof freq === 'function';
    for (let i = 0; i < out.length; i++) {
        const t = i * dt;
        const f = isFn ? freq(t) : freq;
        phase += f * dt;
        phase -= Math.floor(phase);
        out[i] = 4 * Math.abs(phase - 0.5) - 1;
    }
    return out;
}

export function renderSquare(
    durationSec: number,
    freq: number | ((t: number) => number),
    sampleRate: number = SAMPLE_RATE
): MonoBuffer {
    const out = createMono(durationSec, sampleRate);
    const dt = 1 / sampleRate;
    let phase = 0;
    const isFn = typeof freq === 'function';
    for (let i = 0; i < out.length; i++) {
        const t = i * dt;
        const f = isFn ? freq(t) : freq;
        phase += f * dt;
        phase -= Math.floor(phase);
        out[i] = phase < 0.5 ? 1 : -1;
    }
    return out;
}

export function renderSaw(
    durationSec: number,
    freq: number | ((t: number) => number),
    sampleRate: number = SAMPLE_RATE
): MonoBuffer {
    const out = createMono(durationSec, sampleRate);
    const dt = 1 / sampleRate;
    let phase = 0;
    const isFn = typeof freq === 'function';
    for (let i = 0; i < out.length; i++) {
        const t = i * dt;
        const f = isFn ? freq(t) : freq;
        phase += f * dt;
        phase -= Math.floor(phase);
        out[i] = 2 * phase - 1;
    }
    return out;
}

export function renderNoise(durationSec: number, sampleRate: number = SAMPLE_RATE, seed = 1): MonoBuffer {
    const out = createMono(durationSec, sampleRate);
    let state = seed >>> 0;
    for (let i = 0; i < out.length; i++) {
        state = (state * 1664525 + 1013904223) >>> 0;
        out[i] = (state / 0xffffffff) * 2 - 1;
    }
    return out;
}

export function renderFmOscillator(
    durationSec: number,
    carrierFreq: number,
    modFreq: number,
    modIndex: number | ((t: number) => number),
    sampleRate: number = SAMPLE_RATE
): MonoBuffer {
    const out = createMono(durationSec, sampleRate);
    const dt = 1 / sampleRate;
    let cPhase = 0;
    let mPhase = 0;
    const isFn = typeof modIndex === 'function';
    for (let i = 0; i < out.length; i++) {
        const t = i * dt;
        mPhase += TWO_PI * modFreq * dt;
        const idx = isFn ? modIndex(t) : modIndex;
        const mod = Math.sin(mPhase) * idx;
        cPhase += TWO_PI * carrierFreq * dt;
        out[i] = Math.sin(cPhase + mod);
    }
    return out;
}

export function midiToFreq(note: number): number {
    return 440 * 2 ** ((note - 69) / 12);
}
