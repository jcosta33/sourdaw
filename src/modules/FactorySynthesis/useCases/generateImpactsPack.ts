import { createMono, createStereo, toAudioBufferStereo } from '../services/bufferCreation';
import { SAMPLE_RATE } from '../services/constants';
import { normalizeStereo, softClipStereo } from '../services/dynamics';
import { feedbackDelay } from '../services/effects';
import { applyEnvelope, renderEnvelope } from '../services/envelopes';
import { biquad } from '../services/filters';
import { mixMono, mixMonoIntoStereo } from '../services/mixing';
import { renderNoise, renderSine, renderTriangle } from '../services/oscillators';

import { type FactorySample } from './types';

function renderSubDrop(): [Float32Array, Float32Array] {
    const dur = 3;
    const out = createStereo(dur);

    const sub = renderSine(dur, (t) => 90 * 0.35 ** t);
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
