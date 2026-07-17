import { createMono, toAudioBufferMono } from '../services/bufferCreation';
import { SAMPLE_RATE } from '../services/constants';
import { normalize, softClip } from '../services/dynamics';
import { bitcrush } from '../services/effects';
import { applyEnvelope, renderEnvelope } from '../services/envelopes';
import { biquad } from '../services/filters';
import { mixMono } from '../services/mixing';
import { renderNoise, renderSine } from '../services/oscillators';

import { type FactorySample } from './types';

// Lo-fi aesthetic = LPF around 2 kHz, mild bitcrush, and dusty noise bed.
function renderLofiKick(): Float32Array {
    const dur = 0.55;
    const body = renderSine(dur, (t) => 50 + 90 * Math.exp(-t * 30));
    const env = renderEnvelope(dur, {
        attack: 0.003,
        decay: 0.1,
        sustainLevel: 0.35,
        sustain: 0,
        release: 0.42,
        curve: 'exp',
    });
    applyEnvelope(body, env);
    biquad(body, { type: 'lowpass', freq: 2000, q: 0.6 });
    bitcrush(body, 10, 2);
    softClip(body, 1.25);
    normalize(body, 0.9);
    return body;
}

function renderLofiSnare(): Float32Array {
    const dur = 0.25;
    const out = createMono(dur);
    const tone = renderSine(dur, 190);
    const tEnv = renderEnvelope(dur, {
        attack: 0.001,
        decay: 0.05,
        sustainLevel: 0.15,
        sustain: 0,
        release: 0.18,
        curve: 'exp',
    });
    applyEnvelope(tone, tEnv);
    mixMono(out, tone, 0.4);

    const noise = renderNoise(dur, SAMPLE_RATE, 555);
    biquad(noise, { type: 'bandpass', freq: 1800, q: 0.8 });
    const nEnv = renderEnvelope(dur, {
        attack: 0.001,
        decay: 0.04,
        sustainLevel: 0.3,
        sustain: 0,
        release: 0.2,
        curve: 'exp',
    });
    applyEnvelope(noise, nEnv);
    mixMono(out, noise, 0.75);

    biquad(out, { type: 'lowpass', freq: 4500, q: 0.6 });
    bitcrush(out, 9, 2);
    normalize(out, 0.85);
    return out;
}

function renderMuffledHat(): Float32Array {
    const dur = 0.08;
    const out = renderNoise(dur, SAMPLE_RATE, 21);
    biquad(out, { type: 'bandpass', freq: 5500, q: 1.5 });
    biquad(out, { type: 'lowpass', freq: 7000, q: 0.6 });
    const env = renderEnvelope(dur, { attack: 0.001, release: 0.07, curve: 'exp' });
    applyEnvelope(out, env);
    bitcrush(out, 10, 2);
    normalize(out, 0.65);
    return out;
}

function renderVinylSwirl(): Float32Array {
    const dur = 1.4;
    const out = renderNoise(dur, SAMPLE_RATE, 12345);
    biquad(out, { type: 'bandpass', freq: 2500, q: 0.5 });
    // Low-rate modulation gives the swirl motion.
    for (let i = 0; i < out.length; i++) {
        const t = i / SAMPLE_RATE;
        out[i]! *= 0.3 + 0.7 * (Math.sin(2 * Math.PI * 0.7 * t) * 0.5 + 0.5);
    }
    const env = renderEnvelope(dur, { attack: 0.05, release: 1.3, curve: 'exp' });
    applyEnvelope(out, env);
    bitcrush(out, 8, 3);
    normalize(out, 0.65);
    return out;
}

function renderWobblePerc(): Float32Array {
    const dur = 0.6;
    const out = createMono(dur);
    const body = renderSine(dur, (t) => 180 + 40 * Math.sin(2 * Math.PI * 6 * t));
    const env = renderEnvelope(dur, {
        attack: 0.005,
        decay: 0.1,
        sustainLevel: 0.4,
        sustain: 0.1,
        release: 0.4,
        curve: 'exp',
    });
    applyEnvelope(body, env);
    mixMono(out, body, 0.8);
    biquad(out, { type: 'lowpass', freq: 2800, q: 0.9 });
    bitcrush(out, 10, 2);
    normalize(out, 0.85);
    return out;
}

function renderKickGhost(): Float32Array {
    const dur = 0.2;
    const body = renderSine(dur, (t) => 50 + 60 * Math.exp(-t * 30));
    const env = renderEnvelope(dur, {
        attack: 0.005,
        decay: 0.05,
        sustainLevel: 0.2,
        sustain: 0,
        release: 0.14,
        curve: 'exp',
    });
    applyEnvelope(body, env);
    biquad(body, { type: 'lowpass', freq: 1800, q: 0.7 });
    bitcrush(body, 10, 2);
    normalize(body, 0.55);
    return body;
}

function renderLofiClap(): Float32Array {
    const dur = 0.25;
    const out = createMono(dur);
    const offsets = [0, 0.013, 0.024];
    const vols = [0.7, 0.85, 0.6];
    for (let b = 0; b < offsets.length; b++) {
        const burst = renderNoise(0.02, SAMPLE_RATE, 301 + b * 5);
        biquad(burst, { type: 'bandpass', freq: 1400, q: 1.1 });
        const env = renderEnvelope(0.02, { attack: 0.0005, release: 0.017, curve: 'exp' });
        applyEnvelope(burst, env);
        mixMono(out, burst, vols[b]!, Math.floor(offsets[b]! * SAMPLE_RATE));
    }
    biquad(out, { type: 'lowpass', freq: 3500, q: 0.6 });
    bitcrush(out, 9, 3);
    normalize(out, 0.82);
    return out;
}

function renderLofiShaker(): Float32Array {
    const dur = 0.15;
    const out = renderNoise(dur, SAMPLE_RATE, 401);
    biquad(out, { type: 'bandpass', freq: 4000, q: 0.9 });
    const env = renderEnvelope(dur, { attack: 0.008, release: 0.13, curve: 'exp' });
    applyEnvelope(out, env);
    biquad(out, { type: 'lowpass', freq: 6000, q: 0.6 });
    bitcrush(out, 10, 2);
    normalize(out, 0.7);
    return out;
}

export function generateLofiKit(ctx: AudioContext): FactorySample[] {
    const base = 'factory-lofi';
    const tags = ['lo-fi', 'lofi', 'dusty', 'vintage', 'drum'];
    const samples: FactorySample[] = [
        {
            id: `${base}-kick`,
            name: 'Lo-fi Kick',
            category: 'drums',
            tags: [...tags, 'kick'],
            buffer: toAudioBufferMono(ctx, renderLofiKick()),
        },
        {
            id: `${base}-snare`,
            name: 'Lo-fi Dusty Snare',
            category: 'drums',
            tags: [...tags, 'snare'],
            buffer: toAudioBufferMono(ctx, renderLofiSnare()),
        },
        {
            id: `${base}-hat`,
            name: 'Lo-fi Muffled Hat',
            category: 'drums',
            tags: [...tags, 'hat'],
            buffer: toAudioBufferMono(ctx, renderMuffledHat()),
        },
        {
            id: `${base}-vinyl-swirl`,
            name: 'Lo-fi Vinyl Swirl',
            category: 'drums',
            tags: [...tags, 'vinyl', 'texture'],
            buffer: toAudioBufferMono(ctx, renderVinylSwirl()),
        },
        {
            id: `${base}-wobble-perc`,
            name: 'Lo-fi Wobble Perc',
            category: 'drums',
            tags: [...tags, 'perc', 'wobble'],
            buffer: toAudioBufferMono(ctx, renderWobblePerc()),
        },
        {
            id: `${base}-kick-ghost`,
            name: 'Lo-fi Ghost Kick',
            category: 'drums',
            tags: [...tags, 'kick', 'ghost'],
            buffer: toAudioBufferMono(ctx, renderKickGhost()),
        },
        {
            id: `${base}-clap`,
            name: 'Lo-fi Clap',
            category: 'drums',
            tags: [...tags, 'clap'],
            buffer: toAudioBufferMono(ctx, renderLofiClap()),
        },
        {
            id: `${base}-shaker`,
            name: 'Lo-fi Shaker',
            category: 'drums',
            tags: [...tags, 'shaker'],
            buffer: toAudioBufferMono(ctx, renderLofiShaker()),
        },
    ];
    return samples;
}
