import {
    applyEnvelope,
    biquad,
    biquadSweep,
    createMono,
    mixMono,
    normalize,
    renderEnvelope,
    renderSaw,
    renderSine,
    renderSquare,
    renderTriangle,
    softClip,
    toAudioBufferMono,
    midiToFreq,
} from './synthesis';
import { type FactorySample } from './types';

const C1 = 24;
const C1_FREQ = midiToFreq(C1);

function renderSineSub(): Float32Array {
    const dur = 1.5;
    const body = renderSine(dur, C1_FREQ);
    const env = renderEnvelope(dur, {
        attack: 0.01,
        decay: 0.05,
        sustainLevel: 0.85,
        sustain: 1,
        release: 0.4,
        curve: 'exp',
    });
    applyEnvelope(body, env);
    normalize(body, 0.9);
    return body;
}

function renderSquareReese(): Float32Array {
    const dur = 1.4;
    const out = createMono(dur);
    // Two detuned squares = classic Reese bass thickness.
    const a = renderSquare(dur, C1_FREQ);
    const b = renderSquare(dur, C1_FREQ * 1.008);
    mixMono(out, a, 0.5);
    mixMono(out, b, 0.5);
    biquad(out, { type: 'lowpass', freq: 800, q: 0.9 });
    const env = renderEnvelope(dur, {
        attack: 0.02,
        decay: 0.1,
        sustainLevel: 0.7,
        sustain: 0.8,
        release: 0.4,
        curve: 'exp',
    });
    applyEnvelope(out, env);
    softClip(out, 1.2);
    normalize(out, 0.9);
    return out;
}

function renderWobbleBass(): Float32Array {
    const dur = 1.5;
    const out = renderSaw(dur, C1_FREQ);
    biquadSweep(out, { type: 'lowpass', q: 4, freqStart: 200, freqEnd: 1200 });
    // LFO'd amplitude for the wobble character.
    for (let i = 0; i < out.length; i++) {
        const t = i / 44100;
        out[i]! *= 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t);
    }
    const env = renderEnvelope(dur, {
        attack: 0.02,
        decay: 0.1,
        sustainLevel: 0.7,
        sustain: 0.9,
        release: 0.4,
        curve: 'exp',
    });
    applyEnvelope(out, env);
    softClip(out, 1.3);
    normalize(out, 0.9);
    return out;
}

function renderSawBass(): Float32Array {
    const dur = 1.5;
    const out = renderSaw(dur, C1_FREQ);
    biquad(out, { type: 'lowpass', freq: 1200, q: 1.2 });
    const env = renderEnvelope(dur, {
        attack: 0.005,
        decay: 0.1,
        sustainLevel: 0.7,
        sustain: 0.9,
        release: 0.3,
        curve: 'exp',
    });
    applyEnvelope(out, env);
    softClip(out, 1.15);
    normalize(out, 0.9);
    return out;
}

function renderTb303(): Float32Array {
    const dur = 0.8;
    const out = renderSaw(dur, C1_FREQ);
    // Resonant filter sweep — the 303 signature.
    biquadSweep(out, { type: 'lowpass', q: 8, freqStart: 1500, freqEnd: 300 });
    const env = renderEnvelope(dur, {
        attack: 0.003,
        decay: 0.08,
        sustainLevel: 0.35,
        sustain: 0,
        release: 0.65,
        curve: 'exp',
    });
    applyEnvelope(out, env);
    softClip(out, 1.4);
    normalize(out, 0.9);
    return out;
}

function renderPadBass(): Float32Array {
    const dur = 2.0;
    const out = createMono(dur);
    const a = renderSine(dur, C1_FREQ);
    const b = renderTriangle(dur, C1_FREQ * 2);
    const c = renderSine(dur, C1_FREQ * 3);
    mixMono(out, a, 0.6);
    mixMono(out, b, 0.25);
    mixMono(out, c, 0.15);
    biquad(out, { type: 'lowpass', freq: 600, q: 0.7 });
    const env = renderEnvelope(dur, {
        attack: 0.15,
        decay: 0.2,
        sustainLevel: 0.75,
        sustain: 1.1,
        release: 0.5,
        curve: 'exp',
    });
    applyEnvelope(out, env);
    normalize(out, 0.85);
    return out;
}

export function generateBassPack(ctx: AudioContext): FactorySample[] {
    const base = 'factory-bass';
    const tags = ['bass', 'low-end'];
    return [
        { id: `${base}-sine-sub`, name: 'Sine Sub Bass C1', render: renderSineSub, extra: ['sub', 'sine'] },
        { id: `${base}-reese`, name: 'Square Reese C1', render: renderSquareReese, extra: ['reese', 'square'] },
        { id: `${base}-wobble`, name: 'Wobble Bass C1', render: renderWobbleBass, extra: ['wobble', 'dubstep'] },
        { id: `${base}-saw`, name: 'Saw Bass C1', render: renderSawBass, extra: ['saw'] },
        { id: `${base}-tb303`, name: 'TB-303 Pluck C1', render: renderTb303, extra: ['303', 'acid', 'pluck'] },
        { id: `${base}-pad`, name: 'Pad Bass C1', render: renderPadBass, extra: ['pad', 'warm'] },
    ].map((s) => ({
        id: s.id,
        name: s.name,
        category: 'bass' as const,
        tags: [...tags, ...s.extra],
        pitch: C1,
        buffer: toAudioBufferMono(ctx, s.render()),
    }));
}
