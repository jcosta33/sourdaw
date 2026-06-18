import {
    applyEnvelope,
    biquad,
    biquadSweep,
    createMono,
    feedbackDelay,
    mixMono,
    normalize,
    renderEnvelope,
    renderFmOscillator,
    renderNoise,
    renderSine,
    renderSquare,
    renderTriangle,
    softClip,
    toAudioBufferMono,
    SAMPLE_RATE,
} from './synthesis';
import { type FactorySample } from './types';

function renderZap(): Float32Array {
    const dur = 0.15;
    const body = renderSine(dur, (t) => 2500 * Math.exp(-t * 25));
    const env = renderEnvelope(dur, { attack: 0.001, release: 0.14, curve: 'exp' });
    applyEnvelope(body, env);
    softClip(body, 1.3);
    normalize(body, 0.85);
    return body;
}

function renderBlip(): Float32Array {
    const dur = 0.1;
    const out = renderSquare(dur, 1200);
    const env = renderEnvelope(dur, { attack: 0.002, release: 0.09, curve: 'exp' });
    applyEnvelope(out, env);
    biquad(out, { type: 'lowpass', freq: 4000, q: 1.2 });
    normalize(out, 0.8);
    return out;
}

function renderPluckPerc(): Float32Array {
    const dur = 0.25;
    const out = createMono(dur);
    const body = renderFmOscillator(dur, 400, 800, (t) => 3 * Math.exp(-t * 20));
    const env = renderEnvelope(dur, {
        attack: 0.001,
        decay: 0.05,
        sustainLevel: 0.2,
        sustain: 0,
        release: 0.2,
        curve: 'exp',
    });
    applyEnvelope(body, env);
    mixMono(out, body, 0.9);
    biquad(out, { type: 'bandpass', freq: 800, q: 0.8 });
    normalize(out, 0.85);
    return out;
}

function renderChirp(): Float32Array {
    const dur = 0.2;
    // Upward pitch sweep — birdlike chirp.
    const body = renderSine(dur, (t) => 1200 + 3000 * t);
    const env = renderEnvelope(dur, {
        attack: 0.005,
        decay: 0.05,
        sustainLevel: 0.3,
        sustain: 0,
        release: 0.15,
        curve: 'exp',
    });
    applyEnvelope(body, env);
    normalize(body, 0.8);
    return body;
}

function renderSubBurst(): Float32Array {
    const dur = 0.3;
    const out = createMono(dur);
    const body = renderSine(dur, (t) => 80 - 40 * t);
    const env = renderEnvelope(dur, { attack: 0.005, release: 0.29, curve: 'exp' });
    applyEnvelope(body, env);
    mixMono(out, body, 1);
    softClip(out, 1.3);
    normalize(out, 0.9);
    return out;
}

function renderNoiseRiser(): Float32Array {
    const dur = 0.6;
    const out = renderNoise(dur, SAMPLE_RATE, 2111);
    biquadSweep(out, { type: 'bandpass', q: 2, freqStart: 500, freqEnd: 8000 });
    // Amplitude rises with the sweep.
    for (let i = 0; i < out.length; i++) {
        out[i]! *= 0.3 + 0.7 * (i / out.length);
    }
    const env = renderEnvelope(dur, { attack: 0.3, release: 0.3, curve: 'linear' });
    applyEnvelope(out, env);
    normalize(out, 0.85);
    return out;
}

function renderMetallicRing(): Float32Array {
    const dur = 0.8;
    const out = createMono(dur);
    const partials = [1470, 2130, 3060, 4410, 5980];
    const amps = [0.5, 0.4, 0.3, 0.2, 0.12];
    for (let p = 0; p < partials.length; p++) {
        const s = renderSine(dur, partials[p]!);
        const env = renderEnvelope(dur, { attack: 0.002, release: dur * (0.4 + 0.1 * p), curve: 'exp' });
        applyEnvelope(s, env);
        mixMono(out, s, amps[p]!);
    }
    feedbackDelay(out, 0.08, 0.5, 0.3);
    normalize(out, 0.85);
    return out;
}

function renderSweepDown(): Float32Array {
    const dur = 0.4;
    const out = createMono(dur);
    const body = renderTriangle(dur, (t) => 3000 * 0.1 ** (t / dur));
    const env = renderEnvelope(dur, { attack: 0.005, release: 0.38, curve: 'exp' });
    applyEnvelope(body, env);
    mixMono(out, body, 0.9);
    normalize(out, 0.85);
    return out;
}

export function generateElectronicPerc(ctx: AudioContext): FactorySample[] {
    const base = 'factory-electronic-perc';
    const tags = ['electronic', 'percussion', 'synthetic'];
    return [
        { id: `${base}-zap`, name: 'Zap', render: renderZap, extra: ['zap', 'fx'] },
        { id: `${base}-blip`, name: 'Blip', render: renderBlip, extra: ['blip'] },
        { id: `${base}-pluck`, name: 'Pluck Perc', render: renderPluckPerc, extra: ['pluck'] },
        { id: `${base}-chirp`, name: 'Chirp', render: renderChirp, extra: ['chirp'] },
        { id: `${base}-sub-burst`, name: 'Sub Burst', render: renderSubBurst, extra: ['sub'] },
        { id: `${base}-noise-riser`, name: 'Noise Riser Perc', render: renderNoiseRiser, extra: ['noise', 'riser'] },
        { id: `${base}-metallic-ring`, name: 'Metallic Ring', render: renderMetallicRing, extra: ['metallic', 'ring'] },
        { id: `${base}-sweep-down`, name: 'Sweep Down', render: renderSweepDown, extra: ['sweep'] },
    ].map((s) => ({
        id: s.id,
        name: s.name,
        category: 'drums' as const,
        tags: [...tags, ...s.extra],
        buffer: toAudioBufferMono(ctx, s.render()),
    }));
}
