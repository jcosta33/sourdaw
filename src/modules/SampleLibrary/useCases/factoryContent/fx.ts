import { type FactorySample } from './types';
import {
    applyEnvelope,
    biquad,
    biquadSweep,
    createMono,
    createStereo,
    feedbackDelay,
    mixMono,
    mixMonoIntoStereo,
    normalizeStereo,
    renderEnvelope,
    renderNoise,
    renderSine,
    renderTriangle,
    softClipStereo,
    toAudioBufferStereo,
    SAMPLE_RATE,
} from './synthesis';

function renderWhiteNoiseRiser(): [Float32Array, Float32Array] {
    const dur = 3.5;
    const out = createStereo(dur);

    const leftNoise = renderNoise(dur, SAMPLE_RATE, 101);
    biquadSweep(leftNoise, { type: 'bandpass', q: 2, freqStart: 300, freqEnd: 8000 });
    const rightNoise = renderNoise(dur, SAMPLE_RATE, 202);
    biquadSweep(rightNoise, { type: 'bandpass', q: 2, freqStart: 280, freqEnd: 8200 });

    const env = renderEnvelope(dur, { attack: dur * 0.85, release: dur * 0.15, curve: 'linear' });
    applyEnvelope(leftNoise, env);
    applyEnvelope(rightNoise, env);

    mixMonoIntoStereo(out, leftNoise, 0.9, -0.3);
    mixMonoIntoStereo(out, rightNoise, 0.9, 0.3);
    softClipStereo(out, 1.1);
    normalizeStereo(out, 0.9);
    return out;
}

function renderTonalRiser(): [Float32Array, Float32Array] {
    const dur = 3;
    const out = createStereo(dur);
    const fundamentals = [110, 165, 220, 330];
    for (let p = 0; p < fundamentals.length; p++) {
        const base = fundamentals[p]!;
        const body = renderSine(dur, (t) => base * (1 + 2 * Math.pow(t / dur, 2)));
        const env = renderEnvelope(dur, { attack: dur * 0.8, release: dur * 0.2, curve: 'exp' });
        applyEnvelope(body, env);
        mixMonoIntoStereo(out, body, 0.3, p % 2 === 0 ? -0.4 : 0.4);
    }
    normalizeStereo(out, 0.9);
    return out;
}

function renderPitchBendRiser(): [Float32Array, Float32Array] {
    const dur = 2.5;
    const out = createStereo(dur);
    const sweep = renderSine(dur, (t) => 200 * Math.pow(20, t / dur));
    const env = renderEnvelope(dur, { attack: dur * 0.7, release: dur * 0.3, curve: 'exp' });
    applyEnvelope(sweep, env);

    // Panning sweep across stereo field.
    const len = sweep.length;
    const [l, r] = out;
    for (let i = 0; i < len; i++) {
        const t = i / len;
        const pan = Math.sin(t * Math.PI * 2);
        const leftGain = Math.cos(((pan + 1) * Math.PI) / 4);
        const rightGain = Math.sin(((pan + 1) * Math.PI) / 4);
        const v = sweep[i]!;
        l[i]! += v * leftGain;
        r[i]! += v * rightGain;
    }

    const texture = renderNoise(dur, SAMPLE_RATE, 5550);
    biquadSweep(texture, { type: 'highpass', q: 0.7, freqStart: 800, freqEnd: 6000 });
    applyEnvelope(texture, env);
    mixMonoIntoStereo(out, texture, 0.3, 0);

    normalizeStereo(out, 0.88);
    return out;
}

function renderSweptNoiseRiser(): [Float32Array, Float32Array] {
    const dur = 3.8;
    const out = createStereo(dur);

    const left = renderNoise(dur, SAMPLE_RATE, 711);
    biquadSweep(left, { type: 'highpass', q: 0.7, freqStart: 200, freqEnd: 5000 });
    biquadSweep(left, { type: 'lowpass', q: 1, freqStart: 500, freqEnd: 12000 });

    const right = renderNoise(dur, SAMPLE_RATE, 822);
    biquadSweep(right, { type: 'highpass', q: 0.7, freqStart: 220, freqEnd: 5200 });
    biquadSweep(right, { type: 'lowpass', q: 1, freqStart: 550, freqEnd: 12500 });

    // Non-linear ramp — push most of the energy into the final third.
    for (let i = 0; i < left.length; i++) {
        const t = i / left.length;
        const a = Math.pow(t, 2);
        left[i]! *= a;
        right[i]! *= a;
    }

    mixMonoIntoStereo(out, left, 0.9, -0.5);
    mixMonoIntoStereo(out, right, 0.9, 0.5);
    normalizeStereo(out, 0.88);
    return out;
}

function renderSubDrop(): [Float32Array, Float32Array] {
    const dur = 3;
    const out = createStereo(dur);

    const sub = renderSine(dur, (t) => 90 * Math.pow(0.35, t));
    const subEnv = renderEnvelope(dur, { attack: 0.01, release: 2.9, curve: 'exp' });
    applyEnvelope(sub, subEnv);
    mixMonoIntoStereo(out, sub, 1, 0);

    const boom = renderSine(0.2, (t) => 120 * Math.exp(-t * 10));
    const boomEnv = renderEnvelope(0.2, { attack: 0.002, release: 0.19, curve: 'exp' });
    applyEnvelope(boom, boomEnv);
    mixMonoIntoStereo(out, boom, 0.8, 0);

    softClipStereo(out, 1.3);
    normalizeStereo(out, 0.92);
    return out;
}

function renderCinematicHit(): [Float32Array, Float32Array] {
    const dur = 3.5;
    const out = createStereo(dur);

    const thump = renderSine(dur, (t) => 45 + 60 * Math.exp(-t * 6));
    const thumpEnv = renderEnvelope(dur, { attack: 0.005, release: 3.0, curve: 'exp' });
    applyEnvelope(thump, thumpEnv);
    mixMonoIntoStereo(out, thump, 0.85, 0);

    const metallic = createMono(dur);
    const partials = [180, 260, 430, 620];
    for (let p = 0; p < partials.length; p++) {
        const s = renderSine(dur, partials[p]!);
        const env = renderEnvelope(dur, { attack: 0.01, release: dur * (0.5 + 0.1 * p), curve: 'exp' });
        applyEnvelope(s, env);
        mixMono(metallic, s, 0.25);
    }
    feedbackDelay(metallic, 0.18, 0.45, 0.4);
    mixMonoIntoStereo(out, metallic, 0.6, -0.4);
    mixMonoIntoStereo(out, metallic, 0.6, 0.4);

    softClipStereo(out, 1.15);
    normalizeStereo(out, 0.92);
    return out;
}

function renderReverseCrash(): [Float32Array, Float32Array] {
    const dur = 2.2;
    const out = createStereo(dur);

    const noiseLeft = renderNoise(dur, SAMPLE_RATE, 4440);
    biquad(noiseLeft, { type: 'highpass', freq: 3000, q: 0.6 });
    biquad(noiseLeft, { type: 'peaking', freq: 6500, q: 1.2, gainDb: 4 });

    const noiseRight = renderNoise(dur, SAMPLE_RATE, 4441);
    biquad(noiseRight, { type: 'highpass', freq: 3000, q: 0.6 });
    biquad(noiseRight, { type: 'peaking', freq: 6500, q: 1.2, gainDb: 4 });

    // Reversed envelope — quiet start, loud end, hard cut.
    const env = renderEnvelope(dur, { attack: dur - 0.02, release: 0.02, curve: 'exp' });
    applyEnvelope(noiseLeft, env);
    applyEnvelope(noiseRight, env);

    mixMonoIntoStereo(out, noiseLeft, 0.9, -0.5);
    mixMonoIntoStereo(out, noiseRight, 0.9, 0.5);

    normalizeStereo(out, 0.9);
    return out;
}

function renderGlitchStutter(): [Float32Array, Float32Array] {
    const dur = 2;
    const out = createStereo(dur);

    let cursor = 0;
    let seed = 99;
    while (cursor < dur) {
        const slice = 0.03 + Math.random() * 0.1;
        const freq = 200 + Math.random() * 3000;
        const slicePiece = renderTriangle(slice, freq);
        const sEnv = renderEnvelope(slice, { attack: 0.002, release: slice - 0.002, curve: 'exp' });
        applyEnvelope(slicePiece, sEnv);
        const offset = Math.floor(cursor * SAMPLE_RATE);
        const pan = Math.random() * 2 - 1;
        mixMonoIntoStereo(out, slicePiece, 0.7, pan, offset);
        cursor += slice;
        seed = (seed * 31 + 1) >>> 0;
    }
    normalizeStereo(out, 0.88);
    return out;
}

export function generateRisersPack(ctx: AudioContext): FactorySample[] {
    const base = 'factory-fx-riser';
    const tags = ['fx', 'riser', 'build-up'];
    return [
        { id: `${base}-white-noise`, name: 'White Noise Riser', render: renderWhiteNoiseRiser, extra: ['noise'] },
        { id: `${base}-tonal`, name: 'Tonal Riser', render: renderTonalRiser, extra: ['tonal'] },
        { id: `${base}-pitch-bend`, name: 'Pitch Bend Riser', render: renderPitchBendRiser, extra: ['pitch-bend'] },
        { id: `${base}-swept-noise`, name: 'Swept Noise Riser', render: renderSweptNoiseRiser, extra: ['sweep'] },
    ].map((s) => ({
        id: s.id,
        name: s.name,
        category: 'fx' as const,
        tags: [...tags, ...s.extra],
        buffer: toAudioBufferStereo(ctx, s.render()),
    }));
}

export function generateImpactsPack(ctx: AudioContext): FactorySample[] {
    const base = 'factory-fx-impact';
    const tags = ['fx', 'impact', 'cinematic'];
    return [
        { id: `${base}-sub-drop`, name: 'Sub Drop', render: renderSubDrop, extra: ['sub', 'drop'] },
        { id: `${base}-cinematic-hit`, name: 'Cinematic Hit', render: renderCinematicHit, extra: ['hit'] },
        { id: `${base}-reverse-crash`, name: 'Reverse Crash', render: renderReverseCrash, extra: ['reverse', 'crash'] },
        { id: `${base}-glitch-stutter`, name: 'Glitch Stutter', render: renderGlitchStutter, extra: ['glitch'] },
    ].map((s) => ({
        id: s.id,
        name: s.name,
        category: 'fx' as const,
        tags: [...tags, ...s.extra],
        buffer: toAudioBufferStereo(ctx, s.render()),
    }));
}
