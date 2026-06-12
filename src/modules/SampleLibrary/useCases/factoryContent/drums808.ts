import { type FactorySample } from './types';
import {
    applyEnvelope,
    biquad,
    createMono,
    mixMono,
    normalize,
    renderEnvelope,
    renderNoise,
    renderSine,
    renderTriangle,
    softClip,
    toAudioBufferMono,
    SAMPLE_RATE,
} from './synthesis';

// 808 kicks rely on a long sine sub tail (~0.8 s) and very light saturation.
// The pitch envelope is shallower than a 909 — only a ~20 Hz drop.
function render808Kick(): Float32Array {
    const dur = 1.2;
    const body = renderSine(dur, (t) => 40 + 25 * Math.exp(-t * 15));
    const bodyEnv = renderEnvelope(dur, {
        attack: 0.003,
        decay: 0.12,
        sustainLevel: 0.55,
        sustain: 0.2,
        release: 0.85,
        curve: 'exp',
    });
    applyEnvelope(body, bodyEnv);

    const click = renderTriangle(0.015, 2000);
    const clickEnv = renderEnvelope(0.015, { attack: 0.0005, release: 0.012, curve: 'exp' });
    applyEnvelope(click, clickEnv);

    const out = createMono(dur);
    mixMono(out, body, 1);
    mixMono(out, click, 0.18);
    softClip(out, 1.15);
    normalize(out, 0.95);
    return out;
}

function render808Snare(): Float32Array {
    const dur = 0.22;
    const out = createMono(dur);
    const tone = renderSine(dur, 220);
    const toneEnv = renderEnvelope(dur, {
        attack: 0.001,
        decay: 0.06,
        sustainLevel: 0.1,
        sustain: 0,
        release: 0.14,
        curve: 'exp',
    });
    applyEnvelope(tone, toneEnv);
    mixMono(out, tone, 0.5);

    const noise = renderNoise(dur, SAMPLE_RATE, 808);
    biquad(noise, { type: 'highpass', freq: 1200, q: 0.7 });
    biquad(noise, { type: 'peaking', freq: 5500, q: 1.5, gainDb: 6 });
    const noiseEnv = renderEnvelope(dur, {
        attack: 0.001,
        decay: 0.02,
        sustainLevel: 0.3,
        sustain: 0,
        release: 0.18,
        curve: 'exp',
    });
    applyEnvelope(noise, noiseEnv);
    mixMono(out, noise, 0.9);
    softClip(out, 1.1);
    normalize(out, 0.9);
    return out;
}

function render808Clap(): Float32Array {
    const dur = 0.25;
    const out = createMono(dur);
    // Trap claps hit harder — tighter burst spacing and more HF content.
    const offsets = [0, 0.009, 0.019];
    const vols = [0.85, 0.95, 0.75];
    for (let b = 0; b < offsets.length; b++) {
        const burst = renderNoise(0.018, SAMPLE_RATE, 880 + b * 7);
        biquad(burst, { type: 'bandpass', freq: 2000, q: 1.4 });
        const env = renderEnvelope(0.018, { attack: 0.0003, release: 0.016, curve: 'exp' });
        applyEnvelope(burst, env);
        mixMono(out, burst, vols[b]!, Math.floor(offsets[b]! * SAMPLE_RATE));
    }
    const tail = renderNoise(dur, SAMPLE_RATE, 90);
    biquad(tail, { type: 'highpass', freq: 1800, q: 0.8 });
    const tailEnv = renderEnvelope(dur, { attack: 0.02, release: 0.2, curve: 'exp' });
    applyEnvelope(tail, tailEnv);
    mixMono(out, tail, 0.35);
    normalize(out, 0.9);
    return out;
}

function render808TightHat(): Float32Array {
    const dur = 0.04;
    const out = renderNoise(dur, SAMPLE_RATE, 11);
    biquad(out, { type: 'highpass', freq: 8500, q: 0.7 });
    const env = renderEnvelope(dur, { attack: 0.0003, release: 0.035, curve: 'exp' });
    applyEnvelope(out, env);
    normalize(out, 0.7);
    return out;
}

function render808OpenHat(): Float32Array {
    const dur = 0.35;
    const out = renderNoise(dur, SAMPLE_RATE, 19);
    biquad(out, { type: 'highpass', freq: 7500, q: 0.7 });
    biquad(out, { type: 'peaking', freq: 11000, q: 1.2, gainDb: 5 });
    const env = renderEnvelope(dur, { attack: 0.001, release: 0.33, curve: 'exp' });
    applyEnvelope(out, env);
    normalize(out, 0.75);
    return out;
}

function render808RimShot(): Float32Array {
    const dur = 0.08;
    const out = createMono(dur);
    const click = renderTriangle(dur, 1800);
    const clickEnv = renderEnvelope(dur, { attack: 0.0003, release: 0.06, curve: 'exp' });
    applyEnvelope(click, clickEnv);
    mixMono(out, click, 0.9);

    const noise = renderNoise(dur, SAMPLE_RATE, 3);
    biquad(noise, { type: 'bandpass', freq: 3200, q: 1.8 });
    const nEnv = renderEnvelope(dur, { attack: 0.0003, release: 0.05, curve: 'exp' });
    applyEnvelope(noise, nEnv);
    mixMono(out, noise, 0.4);
    normalize(out, 0.85);
    return out;
}

function render808Cowbell(): Float32Array {
    const dur = 0.5;
    const out = createMono(dur);
    // 808 cowbell = two square waves at 540/800 Hz. Famous exact ratio.
    const a = renderTriangle(dur, 540);
    const b = renderTriangle(dur, 800);
    const env = renderEnvelope(dur, {
        attack: 0.001,
        decay: 0.02,
        sustainLevel: 0.5,
        sustain: 0,
        release: 0.45,
        curve: 'exp',
    });
    applyEnvelope(a, env);
    const env2 = renderEnvelope(dur, {
        attack: 0.001,
        decay: 0.02,
        sustainLevel: 0.5,
        sustain: 0,
        release: 0.45,
        curve: 'exp',
    });
    applyEnvelope(b, env2);
    mixMono(out, a, 0.5);
    mixMono(out, b, 0.5);
    biquad(out, { type: 'bandpass', freq: 670, q: 1.5 });
    normalize(out, 0.85);
    return out;
}

function render808Tom(): Float32Array {
    const dur = 0.45;
    const out = createMono(dur);
    const body = renderSine(dur, (t) => 90 + 60 * Math.exp(-t * 25));
    const bEnv = renderEnvelope(dur, {
        attack: 0.002,
        decay: 0.08,
        sustainLevel: 0.4,
        sustain: 0,
        release: 0.36,
        curve: 'exp',
    });
    applyEnvelope(body, bEnv);
    mixMono(out, body, 0.95);

    const noise = renderNoise(0.025, SAMPLE_RATE, 33);
    biquad(noise, { type: 'bandpass', freq: 2800, q: 1.8 });
    const nEnv = renderEnvelope(0.025, { attack: 0.0005, release: 0.02, curve: 'exp' });
    applyEnvelope(noise, nEnv);
    mixMono(out, noise, 0.15);
    normalize(out, 0.9);
    return out;
}

export function generate808Kit(ctx: AudioContext): FactorySample[] {
    const base = 'factory-808';
    const tags = ['808', 'trap', 'hip-hop', 'electronic'];
    const specs: { id: string; name: string; render: () => Float32Array; extra: string[] }[] = [
        { id: 'kick', name: '808 Trap Kick', render: render808Kick, extra: ['kick', 'sub', 'boomy'] },
        { id: 'snare', name: '808 Trap Snare', render: render808Snare, extra: ['snare', 'crisp'] },
        { id: 'clap', name: '808 Trap Clap', render: render808Clap, extra: ['clap'] },
        { id: 'tight-hat', name: '808 Tight Hat', render: render808TightHat, extra: ['hat', 'closed'] },
        { id: 'open-hat', name: '808 Open Hat', render: render808OpenHat, extra: ['hat', 'open'] },
        { id: 'rim', name: '808 Rim Shot', render: render808RimShot, extra: ['rim', 'click'] },
        { id: 'cowbell', name: '808 Cowbell', render: render808Cowbell, extra: ['cowbell', 'percussion'] },
        { id: 'tom', name: '808 Tom', render: render808Tom, extra: ['tom'] },
    ];
    return specs.map((s) => ({
        id: `${base}-${s.id}`,
        name: s.name,
        category: 'drums' as const,
        tags: [...tags, ...s.extra],
        buffer: toAudioBufferMono(ctx, s.render()),
    }));
}
