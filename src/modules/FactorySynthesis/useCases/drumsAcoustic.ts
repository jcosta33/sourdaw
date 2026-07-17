import { createMono, toAudioBufferMono } from '../services/bufferCreation';
import { SAMPLE_RATE } from '../services/constants';
import { normalize, softClip } from '../services/dynamics';
import { feedbackDelay } from '../services/effects';
import { applyEnvelope, renderEnvelope } from '../services/envelopes';
import { biquad } from '../services/filters';
import { mixMono } from '../services/mixing';
import { renderNoise, renderSine, renderTriangle } from '../services/oscillators';

import { type FactorySample } from './types';

// Acoustic kick = two layered transients (beater click + shell resonance) plus
// a tuned low-mid thump. Pitch envelope depth is shallower than 909.
function renderAcousticKick(): Float32Array {
    const dur = 0.6;
    const out = createMono(dur);

    const thump = renderSine(dur, (t) => 55 + 40 * Math.exp(-t * 28));
    const thumpEnv = renderEnvelope(dur, {
        attack: 0.003,
        decay: 0.1,
        sustainLevel: 0.3,
        sustain: 0,
        release: 0.4,
        curve: 'exp',
    });
    applyEnvelope(thump, thumpEnv);
    mixMono(out, thump, 0.85);

    const shell = renderSine(dur, 90);
    const shellEnv = renderEnvelope(dur, {
        attack: 0.003,
        decay: 0.05,
        sustainLevel: 0.2,
        sustain: 0,
        release: 0.35,
        curve: 'exp',
    });
    applyEnvelope(shell, shellEnv);
    mixMono(out, shell, 0.3);

    const beater = renderNoise(0.012, SAMPLE_RATE, 7);
    biquad(beater, { type: 'bandpass', freq: 3500, q: 1.5 });
    const beaterEnv = renderEnvelope(0.012, { attack: 0.0005, release: 0.01, curve: 'exp' });
    applyEnvelope(beater, beaterEnv);
    mixMono(out, beater, 0.45);

    softClip(out, 1.1);
    normalize(out, 0.95);
    return out;
}

function renderAcousticSnare(): Float32Array {
    const dur = 0.3;
    const out = createMono(dur);

    const tone = renderSine(dur, 185);
    const toneEnv = renderEnvelope(dur, {
        attack: 0.001,
        decay: 0.04,
        sustainLevel: 0.2,
        sustain: 0,
        release: 0.22,
        curve: 'exp',
    });
    applyEnvelope(tone, toneEnv);
    biquad(tone, { type: 'lowpass', freq: 900, q: 0.7 });
    mixMono(out, tone, 0.55);

    const wires = renderNoise(dur, SAMPLE_RATE, 500);
    biquad(wires, { type: 'highpass', freq: 2000, q: 0.6 });
    biquad(wires, { type: 'peaking', freq: 5000, q: 1.4, gainDb: 5 });
    const wiresEnv = renderEnvelope(dur, {
        attack: 0.001,
        decay: 0.06,
        sustainLevel: 0.3,
        sustain: 0,
        release: 0.24,
        curve: 'exp',
    });
    applyEnvelope(wires, wiresEnv);
    mixMono(out, wires, 0.8);

    // Early reflection gives the acoustic room cue.
    feedbackDelay(out, 0.018, 0.25, 0.15);
    softClip(out, 1.1);
    normalize(out, 0.92);
    return out;
}

function renderAcousticBrushHat(): Float32Array {
    const dur = 0.12;
    const out = renderNoise(dur, SAMPLE_RATE, 55);
    biquad(out, { type: 'highpass', freq: 4000, q: 0.6 });
    biquad(out, { type: 'peaking', freq: 8000, q: 1, gainDb: 3 });
    const env = renderEnvelope(dur, { attack: 0.005, release: 0.1, curve: 'exp' });
    applyEnvelope(out, env);
    normalize(out, 0.7);
    return out;
}

function renderTambourine(): Float32Array {
    const dur = 0.3;
    const out = createMono(dur);
    const shake = renderNoise(dur, SAMPLE_RATE, 77);
    biquad(shake, { type: 'highpass', freq: 5000, q: 0.7 });
    biquad(shake, { type: 'peaking', freq: 9000, q: 1.5, gainDb: 4 });
    const shakeEnv = renderEnvelope(dur, { attack: 0.003, release: 0.28, curve: 'exp' });
    applyEnvelope(shake, shakeEnv);
    mixMono(out, shake, 0.8);

    const partials = [3200, 4600, 6300, 8800];
    for (let p = 0; p < partials.length; p++) {
        const s = renderSine(dur, partials[p]!);
        const sEnv = renderEnvelope(dur, { attack: 0.002, release: dur * (0.4 + 0.1 * p), curve: 'exp' });
        applyEnvelope(s, sEnv);
        mixMono(out, s, 0.06);
    }
    normalize(out, 0.85);
    return out;
}

function renderAcousticRide(): Float32Array {
    const dur = 1.2;
    const out = createMono(dur);
    const body = renderNoise(dur, SAMPLE_RATE, 920);
    biquad(body, { type: 'highpass', freq: 3000, q: 0.6 });
    biquad(body, { type: 'peaking', freq: 6500, q: 1.5, gainDb: 3 });
    const bEnv = renderEnvelope(dur, { attack: 0.002, release: 1.1, curve: 'exp' });
    applyEnvelope(body, bEnv);
    mixMono(out, body, 0.35);

    const partials = [2700, 3420, 4500, 6200, 8100];
    for (let p = 0; p < partials.length; p++) {
        const s = renderSine(dur, partials[p]!);
        const sEnv = renderEnvelope(dur, { attack: 0.001, release: dur * (0.45 + 0.1 * p), curve: 'exp' });
        applyEnvelope(s, sEnv);
        mixMono(out, s, 0.1);
    }

    const bell = renderSine(0.1, 4800);
    const bellEnv = renderEnvelope(0.1, { attack: 0.001, release: 0.09, curve: 'exp' });
    applyEnvelope(bell, bellEnv);
    mixMono(out, bell, 0.5);

    normalize(out, 0.88);
    return out;
}

function renderAcousticTom(pitchHz: number, dur: number): Float32Array {
    const out = createMono(dur);
    const body = renderSine(dur, (t) => pitchHz + pitchHz * 0.4 * Math.exp(-t * 22));
    const bEnv = renderEnvelope(dur, {
        attack: 0.002,
        decay: 0.08,
        sustainLevel: 0.45,
        sustain: 0,
        release: dur - 0.08,
        curve: 'exp',
    });
    applyEnvelope(body, bEnv);
    mixMono(out, body, 0.95);

    const harm = renderTriangle(dur, pitchHz * 2);
    const hEnv = renderEnvelope(dur, { attack: 0.002, release: dur * 0.4, curve: 'exp' });
    applyEnvelope(harm, hEnv);
    mixMono(out, harm, 0.12);

    const thwack = renderNoise(0.02, SAMPLE_RATE, Math.floor(pitchHz));
    biquad(thwack, { type: 'bandpass', freq: 2800, q: 1.8 });
    const tEnv = renderEnvelope(0.02, { attack: 0.0005, release: 0.018, curve: 'exp' });
    applyEnvelope(thwack, tEnv);
    mixMono(out, thwack, 0.22);
    normalize(out, 0.9);
    return out;
}

export function generateAcousticKit(ctx: AudioContext): FactorySample[] {
    const base = 'factory-acoustic';
    const tags = ['acoustic', 'natural', 'organic', 'drum'];
    const samples: FactorySample[] = [
        {
            id: `${base}-kick`,
            name: 'Acoustic Kick',
            category: 'drums',
            tags: [...tags, 'kick'],
            buffer: toAudioBufferMono(ctx, renderAcousticKick()),
        },
        {
            id: `${base}-snare`,
            name: 'Acoustic Snare',
            category: 'drums',
            tags: [...tags, 'snare'],
            buffer: toAudioBufferMono(ctx, renderAcousticSnare()),
        },
        {
            id: `${base}-brush-hat`,
            name: 'Acoustic Brush Hat',
            category: 'drums',
            tags: [...tags, 'hat', 'brush'],
            buffer: toAudioBufferMono(ctx, renderAcousticBrushHat()),
        },
        {
            id: `${base}-tambourine`,
            name: 'Acoustic Tambourine',
            category: 'drums',
            tags: [...tags, 'tambourine', 'percussion'],
            buffer: toAudioBufferMono(ctx, renderTambourine()),
        },
        {
            id: `${base}-ride`,
            name: 'Acoustic Ride',
            category: 'drums',
            tags: [...tags, 'ride', 'cymbal'],
            buffer: toAudioBufferMono(ctx, renderAcousticRide()),
        },
        {
            id: `${base}-tom-high`,
            name: 'Acoustic Tom High',
            category: 'drums',
            tags: [...tags, 'tom', 'high'],
            buffer: toAudioBufferMono(ctx, renderAcousticTom(200, 0.55)),
        },
        {
            id: `${base}-tom-mid`,
            name: 'Acoustic Tom Mid',
            category: 'drums',
            tags: [...tags, 'tom', 'mid'],
            buffer: toAudioBufferMono(ctx, renderAcousticTom(140, 0.65)),
        },
        {
            id: `${base}-tom-low`,
            name: 'Acoustic Tom Low',
            category: 'drums',
            tags: [...tags, 'tom', 'low'],
            buffer: toAudioBufferMono(ctx, renderAcousticTom(95, 0.75)),
        },
    ];
    return samples;
}
