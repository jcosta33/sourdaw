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
import { type FactorySample } from './types';

// 909 kicks need a fast pitch sweep on the first ~60 ms — without that "clack"
// they collapse into a pure sub sine tone, which doesn't cut through a mix.
function render909Kick(): Float32Array {
    const dur = 0.55;
    const body = renderSine(dur, (t) => {
        const sweep = Math.exp(-t * 40);
        return 50 + 150 * sweep;
    });
    const bodyEnv = renderEnvelope(dur, {
        attack: 0.002,
        decay: 0.08,
        sustainLevel: 0.35,
        sustain: 0,
        release: 0.45,
        curve: 'exp',
    });
    applyEnvelope(body, bodyEnv);

    const click = renderTriangle(0.02, 1200);
    const clickEnv = renderEnvelope(0.02, { attack: 0.0005, release: 0.015, curve: 'exp' });
    applyEnvelope(click, clickEnv);

    const out = createMono(dur);
    mixMono(out, body, 1);
    mixMono(out, click, 0.35);
    softClip(out, 1.2);
    normalize(out, 0.95);
    return out;
}

function render909Snare(): Float32Array {
    const dur = 0.25;
    const tone1 = renderSine(dur, 180);
    const tone2 = renderSine(dur, 270);
    const tones = createMono(dur);
    mixMono(tones, tone1, 0.6);
    mixMono(tones, tone2, 0.4);
    const toneEnv = renderEnvelope(dur, {
        attack: 0.001,
        decay: 0.05,
        sustainLevel: 0.1,
        sustain: 0,
        release: 0.2,
        curve: 'exp',
    });
    applyEnvelope(tones, toneEnv);

    const noise = renderNoise(dur, SAMPLE_RATE, 909);
    biquad(noise, { type: 'highpass', freq: 1500, q: 0.7 });
    biquad(noise, { type: 'peaking', freq: 4500, q: 0.9, gainDb: 4 });
    const noiseEnv = renderEnvelope(dur, {
        attack: 0.001,
        decay: 0.04,
        sustainLevel: 0.35,
        sustain: 0,
        release: 0.22,
        curve: 'exp',
    });
    applyEnvelope(noise, noiseEnv);

    const out = createMono(dur);
    mixMono(out, tones, 0.7);
    mixMono(out, noise, 0.85);
    softClip(out, 1.1);
    normalize(out, 0.9);
    return out;
}

function render909Clap(): Float32Array {
    const dur = 0.28;
    const out = createMono(dur);
    const burstOffsets = [0, 0.012, 0.024, 0.04];
    const burstVols = [0.7, 0.95, 0.8, 0.55];
    for (let b = 0; b < burstOffsets.length; b++) {
        const burst = renderNoise(0.02, SAMPLE_RATE, 1000 + b * 13);
        biquad(burst, { type: 'bandpass', freq: 1500, q: 1.2 });
        const env = renderEnvelope(0.02, { attack: 0.0005, release: 0.018, curve: 'exp' });
        applyEnvelope(burst, env);
        mixMono(out, burst, burstVols[b]!, Math.floor(burstOffsets[b]! * SAMPLE_RATE));
    }
    // Tail — a short filtered noise with exponential decay gives the clap its room feel.
    const tail = renderNoise(dur, SAMPLE_RATE, 42);
    biquad(tail, { type: 'bandpass', freq: 1700, q: 1.8 });
    const tailEnv = renderEnvelope(dur, { attack: 0.03, release: 0.22, curve: 'exp' });
    applyEnvelope(tail, tailEnv);
    mixMono(out, tail, 0.4);
    normalize(out, 0.9);
    return out;
}

function render909ClosedHat(): Float32Array {
    const dur = 0.08;
    const out = renderNoise(dur, SAMPLE_RATE, 13);
    biquad(out, { type: 'highpass', freq: 7000, q: 0.7 });
    biquad(out, { type: 'peaking', freq: 10000, q: 1.5, gainDb: 6 });
    const env = renderEnvelope(dur, { attack: 0.0005, release: 0.07, curve: 'exp' });
    applyEnvelope(out, env);
    normalize(out, 0.75);
    return out;
}

function render909OpenHat(): Float32Array {
    const dur = 0.4;
    const out = renderNoise(dur, SAMPLE_RATE, 17);
    biquad(out, { type: 'highpass', freq: 6500, q: 0.7 });
    biquad(out, { type: 'peaking', freq: 9500, q: 1.2, gainDb: 4 });
    // Metallic overtones — a couple of square-wave partials give the classic 909 shimmer.
    const partial1 = renderTriangle(dur, 5200);
    const partial2 = renderTriangle(dur, 8400);
    mixMono(out, partial1, 0.08);
    mixMono(out, partial2, 0.05);
    const env = renderEnvelope(dur, { attack: 0.002, release: 0.38, curve: 'exp' });
    applyEnvelope(out, env);
    normalize(out, 0.8);
    return out;
}

function render909Ride(): Float32Array {
    const dur = 0.9;
    const out = createMono(dur);
    // Ride = noise body + a handful of inharmonic metallic partials.
    const body = renderNoise(dur, SAMPLE_RATE, 900);
    biquad(body, { type: 'highpass', freq: 3500, q: 0.5 });
    biquad(body, { type: 'peaking', freq: 6000, q: 2, gainDb: 4 });
    const bodyEnv = renderEnvelope(dur, { attack: 0.001, release: 0.85, curve: 'exp' });
    applyEnvelope(body, bodyEnv);
    mixMono(out, body, 0.5);

    const partials = [2470, 3100, 4200, 5800, 7300];
    for (let p = 0; p < partials.length; p++) {
        const s = renderSine(dur, partials[p]!);
        const sEnv = renderEnvelope(dur, { attack: 0.001, release: dur * (0.4 + 0.1 * p), curve: 'exp' });
        applyEnvelope(s, sEnv);
        mixMono(out, s, 0.08);
    }

    const ping = renderSine(0.05, 4500);
    const pingEnv = renderEnvelope(0.05, { attack: 0.0005, release: 0.045, curve: 'exp' });
    applyEnvelope(ping, pingEnv);
    mixMono(out, ping, 0.4);

    normalize(out, 0.85);
    return out;
}

function render909Crash(): Float32Array {
    const dur = 1.8;
    const out = createMono(dur);
    const body = renderNoise(dur, SAMPLE_RATE, 501);
    biquad(body, { type: 'highpass', freq: 2500, q: 0.5 });
    biquad(body, { type: 'peaking', freq: 5000, q: 1.5, gainDb: 5 });
    const bodyEnv = renderEnvelope(dur, { attack: 0.003, release: 1.6, curve: 'exp' });
    applyEnvelope(body, bodyEnv);
    mixMono(out, body, 0.8);

    const partials = [1950, 2830, 3710, 5120, 7200, 9800];
    for (let p = 0; p < partials.length; p++) {
        const s = renderSine(dur, partials[p]!);
        const sEnv = renderEnvelope(dur, { attack: 0.002, release: dur * (0.5 + 0.08 * p), curve: 'exp' });
        applyEnvelope(s, sEnv);
        mixMono(out, s, 0.07);
    }
    normalize(out, 0.9);
    return out;
}

function render909Tom(): Float32Array {
    const dur = 0.6;
    const out = createMono(dur);
    const body = renderSine(dur, (t) => {
        const sweep = Math.exp(-t * 20);
        return 120 + 90 * sweep;
    });
    const bodyEnv = renderEnvelope(dur, {
        attack: 0.002,
        decay: 0.08,
        sustainLevel: 0.4,
        sustain: 0,
        release: 0.5,
        curve: 'exp',
    });
    applyEnvelope(body, bodyEnv);
    mixMono(out, body, 0.9);

    const attack = renderNoise(0.03, SAMPLE_RATE, 2);
    biquad(attack, { type: 'bandpass', freq: 2500, q: 1.5 });
    const attackEnv = renderEnvelope(0.03, { attack: 0.0005, release: 0.025, curve: 'exp' });
    applyEnvelope(attack, attackEnv);
    mixMono(out, attack, 0.2);
    normalize(out, 0.9);
    return out;
}

export function generate909Kit(ctx: AudioContext): FactorySample[] {
    const base = 'factory-909';
    const tags = ['909', 'analog', 'drum-machine', 'electronic'];
    const specs: { id: string; name: string; render: () => Float32Array; extra: string[] }[] = [
        { id: 'kick', name: 'Analog 909 Kick', render: render909Kick, extra: ['kick', 'punchy', 'sub'] },
        { id: 'snare', name: 'Analog 909 Snare', render: render909Snare, extra: ['snare'] },
        { id: 'clap', name: 'Analog 909 Clap', render: render909Clap, extra: ['clap'] },
        { id: 'closed-hat', name: 'Analog 909 Closed Hat', render: render909ClosedHat, extra: ['hat', 'closed'] },
        { id: 'open-hat', name: 'Analog 909 Open Hat', render: render909OpenHat, extra: ['hat', 'open'] },
        { id: 'ride', name: 'Analog 909 Ride', render: render909Ride, extra: ['ride', 'cymbal'] },
        { id: 'crash', name: 'Analog 909 Crash', render: render909Crash, extra: ['crash', 'cymbal'] },
        { id: 'tom', name: 'Analog 909 Tom', render: render909Tom, extra: ['tom'] },
    ];
    return specs.map((s) => ({
        id: `${base}-${s.id}`,
        name: s.name,
        category: 'drums' as const,
        tags: [...tags, ...s.extra],
        buffer: toAudioBufferMono(ctx, s.render()),
    }));
}
