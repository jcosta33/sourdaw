export const SAMPLE_RATE = 44100;
export const TWO_PI = Math.PI * 2;

export type MonoBuffer = Float32Array;
export type StereoBuffer = [Float32Array, Float32Array];

export function createMono(durationSec: number, sampleRate: number = SAMPLE_RATE): MonoBuffer {
    return new Float32Array(Math.max(1, Math.ceil(durationSec * sampleRate)));
}

export function createStereo(durationSec: number, sampleRate: number = SAMPLE_RATE): StereoBuffer {
    const len = Math.max(1, Math.ceil(durationSec * sampleRate));
    return [new Float32Array(len), new Float32Array(len)];
}

export function toAudioBufferMono(ctx: AudioContext, data: MonoBuffer, sampleRate: number = SAMPLE_RATE): AudioBuffer {
    const buf = ctx.createBuffer(1, data.length, sampleRate);
    buf.getChannelData(0).set(data);
    return buf;
}

export function toAudioBufferStereo(
    ctx: AudioContext,
    data: StereoBuffer,
    sampleRate: number = SAMPLE_RATE
): AudioBuffer {
    const buf = ctx.createBuffer(2, data[0].length, sampleRate);
    buf.getChannelData(0).set(data[0]);
    buf.getChannelData(1).set(data[1]);
    return buf;
}

export function mixMono(dst: MonoBuffer, src: MonoBuffer, gain: number, offsetSamples = 0): void {
    const end = Math.min(dst.length, offsetSamples + src.length);
    for (let i = Math.max(0, offsetSamples); i < end; i++) {
        dst[i]! += src[i - offsetSamples]! * gain;
    }
}

export function mixMonoIntoStereo(
    dst: StereoBuffer,
    src: MonoBuffer,
    gain: number,
    pan: number,
    offsetSamples = 0
): void {
    const leftGain = gain * Math.cos(((pan + 1) * Math.PI) / 4);
    const rightGain = gain * Math.sin(((pan + 1) * Math.PI) / 4);
    const [dl, dr] = dst;
    const end = Math.min(dl.length, offsetSamples + src.length);
    for (let i = Math.max(0, offsetSamples); i < end; i++) {
        const v = src[i - offsetSamples]!;
        dl[i]! += v * leftGain;
        dr[i]! += v * rightGain;
    }
}

export function softClip(buf: MonoBuffer, drive = 1): void {
    for (let i = 0; i < buf.length; i++) {
        buf[i] = Math.tanh(buf[i]! * drive);
    }
}

export function softClipStereo(buf: StereoBuffer, drive = 1): void {
    softClip(buf[0], drive);
    softClip(buf[1], drive);
}

export function normalize(buf: MonoBuffer, targetPeak = 0.95): void {
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
        const a = Math.abs(buf[i]!);
        if (a > peak) {
            peak = a;
        }
    }
    if (peak === 0) {
        return;
    }
    const scale = targetPeak / peak;
    for (let i = 0; i < buf.length; i++) {
        buf[i]! *= scale;
    }
}

export function normalizeStereo(buf: StereoBuffer, targetPeak = 0.95): void {
    let peak = 0;
    for (let c = 0; c < 2; c++) {
        const ch = buf[c]!;
        for (let i = 0; i < ch.length; i++) {
            const a = Math.abs(ch[i]!);
            if (a > peak) {
                peak = a;
            }
        }
    }
    if (peak === 0) {
        return;
    }
    const scale = targetPeak / peak;
    for (let c = 0; c < 2; c++) {
        const ch = buf[c]!;
        for (let i = 0; i < ch.length; i++) {
            ch[i]! *= scale;
        }
    }
}

export type EnvelopeSpec = {
    attack?: number;
    decay?: number;
    sustain?: number;
    sustainLevel?: number;
    release?: number;
    curve?: 'linear' | 'exp';
};

export function renderEnvelope(durationSec: number, env: EnvelopeSpec, sampleRate: number = SAMPLE_RATE): MonoBuffer {
    const len = Math.max(1, Math.ceil(durationSec * sampleRate));
    const out = new Float32Array(len);
    const a = Math.max(0, env.attack ?? 0);
    const d = Math.max(0, env.decay ?? 0);
    const sLevel = env.sustainLevel ?? 0;
    const s = Math.max(0, env.sustain ?? 0);
    const r = Math.max(0, env.release ?? durationSec - a - d - s);
    const aSamp = Math.floor(a * sampleRate);
    const dSamp = Math.floor(d * sampleRate);
    const sSamp = Math.floor(s * sampleRate);
    const rSamp = Math.max(1, Math.floor(r * sampleRate));
    const curve = env.curve ?? 'exp';

    for (let i = 0; i < len; i++) {
        let v: number;
        if (i < aSamp) {
            const t = aSamp === 0 ? 1 : i / aSamp;
            v = t;
        } else if (i < aSamp + dSamp) {
            const t = dSamp === 0 ? 1 : (i - aSamp) / dSamp;
            v = curve === 'exp' ? (1 - t) ** 2 * (1 - sLevel) + sLevel : 1 - t * (1 - sLevel);
        } else if (i < aSamp + dSamp + sSamp) {
            v = sLevel;
        } else {
            const t = (i - aSamp - dSamp - sSamp) / rSamp;
            if (t >= 1) {
                v = 0;
            } else {
                v = curve === 'exp' ? sLevel * (1 - t) ** 2 : sLevel * (1 - t);
            }
        }
        out[i] = v;
    }
    return out;
}

export function applyEnvelope(buf: MonoBuffer, env: MonoBuffer): void {
    const len = Math.min(buf.length, env.length);
    for (let i = 0; i < len; i++) {
        buf[i]! *= env[i]!;
    }
    for (let i = len; i < buf.length; i++) {
        buf[i] = 0;
    }
}

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

type BiquadCoeffs = { b0: number; b1: number; b2: number; a1: number; a2: number };

function biquadCoeffs(
    type: 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf',
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

export type BiquadSpec = {
    type: 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf';
    freq: number;
    q?: number;
    gainDb?: number;
};

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

export function bitcrush(buf: MonoBuffer, bits: number, sampleRateReduction = 1): void {
    const steps = 2 ** (bits - 1);
    let held = 0;
    let counter = 0;
    for (let i = 0; i < buf.length; i++) {
        if (counter <= 0) {
            held = Math.round(buf[i]! * steps) / steps;
            counter = sampleRateReduction;
        }
        buf[i] = held;
        counter--;
    }
}

export function feedbackDelay(
    buf: MonoBuffer,
    delaySec: number,
    feedback: number,
    wetMix: number,
    sampleRate: number = SAMPLE_RATE
): void {
    const delaySamples = Math.max(1, Math.floor(delaySec * sampleRate));
    const line = new Float32Array(delaySamples);
    let writeIdx = 0;
    for (let i = 0; i < buf.length; i++) {
        const delayed = line[writeIdx]!;
        const input = buf[i]!;
        line[writeIdx] = input + delayed * feedback;
        writeIdx = (writeIdx + 1) % delaySamples;
        buf[i] = input * (1 - wetMix) + delayed * wetMix;
    }
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
