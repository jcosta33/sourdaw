import { SAMPLE_RATE, TWO_PI } from './constants';

import type { BiquadSpec, MonoBuffer } from './types';

type BiquadCoeffs = { b0: number; b1: number; b2: number; a1: number; a2: number };

function biquadCoeffs(
    type: BiquadSpec['type'],
    freq: number,
    q: number,
    gainDb: number,
    sampleRate: number
): BiquadCoeffs {
    const w0 = (TWO_PI * freq) / sampleRate;
    const cosw = Math.cos(w0);
    const sinw = Math.sin(w0);
    const alpha = sinw / (2 * Math.max(0.0001, q));
    const A = 10 ** (gainDb / 40);

    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let a0 = 1;
    let a1 = 0;
    let a2 = 0;

    switch (type) {
        case 'lowpass':
            b0 = (1 - cosw) / 2;
            b1 = 1 - cosw;
            b2 = (1 - cosw) / 2;
            a0 = 1 + alpha;
            a1 = -2 * cosw;
            a2 = 1 - alpha;
            break;
        case 'highpass':
            b0 = (1 + cosw) / 2;
            b1 = -(1 + cosw);
            b2 = (1 + cosw) / 2;
            a0 = 1 + alpha;
            a1 = -2 * cosw;
            a2 = 1 - alpha;
            break;
        case 'bandpass':
            b0 = alpha;
            b1 = 0;
            b2 = -alpha;
            a0 = 1 + alpha;
            a1 = -2 * cosw;
            a2 = 1 - alpha;
            break;
        case 'peaking':
            b0 = 1 + alpha * A;
            b1 = -2 * cosw;
            b2 = 1 - alpha * A;
            a0 = 1 + alpha / A;
            a1 = -2 * cosw;
            a2 = 1 - alpha / A;
            break;
        case 'lowshelf': {
            const sq = 2 * Math.sqrt(A) * alpha;
            b0 = A * (A + 1 - (A - 1) * cosw + sq);
            b1 = 2 * A * (A - 1 - (A + 1) * cosw);
            b2 = A * (A + 1 - (A - 1) * cosw - sq);
            a0 = A + 1 + (A - 1) * cosw + sq;
            a1 = -2 * (A - 1 + (A + 1) * cosw);
            a2 = A + 1 + (A - 1) * cosw - sq;
            break;
        }
        case 'highshelf': {
            const sq = 2 * Math.sqrt(A) * alpha;
            b0 = A * (A + 1 + (A - 1) * cosw + sq);
            b1 = -2 * A * (A - 1 + (A + 1) * cosw);
            b2 = A * (A + 1 + (A - 1) * cosw - sq);
            a0 = A + 1 - (A - 1) * cosw + sq;
            a1 = 2 * (A - 1 - (A + 1) * cosw);
            a2 = A + 1 - (A - 1) * cosw - sq;
            break;
        }
    }

    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

export function biquad(buf: MonoBuffer, spec: BiquadSpec, sampleRate: number = SAMPLE_RATE): void {
    const { b0, b1, b2, a1, a2 } = biquadCoeffs(spec.type, spec.freq, spec.q ?? 0.707, spec.gainDb ?? 0, sampleRate);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < buf.length; i++) {
        const x = buf[i]!;
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        buf[i] = y;
    }
}

export function biquadSweep(
    buf: MonoBuffer,
    spec: { type: BiquadSpec['type']; q?: number; freqStart: number; freqEnd: number },
    sampleRate: number = SAMPLE_RATE
): void {
    const q = spec.q ?? 0.707;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    const len = buf.length;
    for (let i = 0; i < len; i++) {
        const t = len === 1 ? 1 : i / (len - 1);
        const freq = spec.freqStart * (spec.freqEnd / spec.freqStart) ** t;
        const { b0, b1, b2, a1, a2 } = biquadCoeffs(spec.type, freq, q, 0, sampleRate);
        const x = buf[i]!;
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        buf[i] = y;
    }
}
