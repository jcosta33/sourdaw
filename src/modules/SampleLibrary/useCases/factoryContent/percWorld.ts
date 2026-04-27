import { type FactorySample } from './types';
import {
    applyEnvelope,
    biquad,
    createMono,
    mixMono,
    normalize,
    renderEnvelope,
    renderFmOscillator,
    renderNoise,
    renderSine,
    renderTriangle,
    toAudioBufferMono,
    SAMPLE_RATE,
} from './synthesis';

function renderTabla(): Float32Array {
    const dur = 0.35;
    const out = createMono(dur);
    // "Na" — pitched bend with fast decay and mid-range slap transient.
    const body = renderSine(dur, (t) => 250 + 180 * Math.exp(-t * 45));
    const env = renderEnvelope(dur, {
        attack: 0.002,
        decay: 0.05,
        sustainLevel: 0.2,
        sustain: 0,
        release: 0.3,
        curve: 'exp',
    });
    applyEnvelope(body, env);
    mixMono(out, body, 0.85);

    const slap = renderNoise(0.02, SAMPLE_RATE, 71);
    biquad(slap, { type: 'bandpass', freq: 3500, q: 2 });
    const sEnv = renderEnvelope(0.02, { attack: 0.0005, release: 0.018, curve: 'exp' });
    applyEnvelope(slap, sEnv);
    mixMono(out, slap, 0.4);
    normalize(out, 0.88);
    return out;
}

function renderBongo(): Float32Array {
    const dur = 0.25;
    const out = createMono(dur);
    const body = renderSine(dur, (t) => 220 + 110 * Math.exp(-t * 40));
    const env = renderEnvelope(dur, {
        attack: 0.002,
        decay: 0.05,
        sustainLevel: 0.2,
        sustain: 0,
        release: 0.2,
        curve: 'exp',
    });
    applyEnvelope(body, env);
    mixMono(out, body, 0.9);

    const slap = renderNoise(0.015, SAMPLE_RATE, 33);
    biquad(slap, { type: 'bandpass', freq: 2800, q: 1.8 });
    const sEnv = renderEnvelope(0.015, { attack: 0.0005, release: 0.013, curve: 'exp' });
    applyEnvelope(slap, sEnv);
    mixMono(out, slap, 0.25);
    normalize(out, 0.9);
    return out;
}

function renderDjembe(): Float32Array {
    const dur = 0.5;
    const out = createMono(dur);
    const body = renderSine(dur, (t) => 120 + 80 * Math.exp(-t * 25));
    const env = renderEnvelope(dur, {
        attack: 0.003,
        decay: 0.08,
        sustainLevel: 0.35,
        sustain: 0,
        release: 0.4,
        curve: 'exp',
    });
    applyEnvelope(body, env);
    mixMono(out, body, 0.85);

    const slap = renderNoise(0.03, SAMPLE_RATE, 93);
    biquad(slap, { type: 'bandpass', freq: 2200, q: 1.4 });
    const sEnv = renderEnvelope(0.03, { attack: 0.0005, release: 0.025, curve: 'exp' });
    applyEnvelope(slap, sEnv);
    mixMono(out, slap, 0.35);
    normalize(out, 0.92);
    return out;
}

function renderShaker(): Float32Array {
    const dur = 0.11;
    const out = renderNoise(dur, SAMPLE_RATE, 881);
    biquad(out, { type: 'highpass', freq: 5500, q: 0.8 });
    biquad(out, { type: 'peaking', freq: 9000, q: 1.2, gainDb: 4 });
    const env = renderEnvelope(dur, { attack: 0.005, release: 0.1, curve: 'exp' });
    applyEnvelope(out, env);
    normalize(out, 0.75);
    return out;
}

function renderAgogo(): Float32Array {
    const dur = 0.4;
    const out = createMono(dur);
    // Two metal bells — mid (lower cowbell-like pitch) with bright partials.
    const fund = renderTriangle(dur, 880);
    const partial = renderTriangle(dur, 1760);
    const env = renderEnvelope(dur, {
        attack: 0.001,
        decay: 0.03,
        sustainLevel: 0.3,
        sustain: 0,
        release: 0.35,
        curve: 'exp',
    });
    applyEnvelope(fund, env);
    const env2 = renderEnvelope(dur, {
        attack: 0.001,
        decay: 0.02,
        sustainLevel: 0.2,
        sustain: 0,
        release: 0.3,
        curve: 'exp',
    });
    applyEnvelope(partial, env2);
    mixMono(out, fund, 0.7);
    mixMono(out, partial, 0.35);
    biquad(out, { type: 'bandpass', freq: 1200, q: 1.1 });
    normalize(out, 0.85);
    return out;
}

function renderClaves(): Float32Array {
    const dur = 0.08;
    const out = renderSine(dur, 2500);
    const env = renderEnvelope(dur, { attack: 0.0003, release: 0.07, curve: 'exp' });
    applyEnvelope(out, env);
    const secondary = renderSine(dur, 3500);
    const sEnv = renderEnvelope(dur, { attack: 0.0003, release: 0.06, curve: 'exp' });
    applyEnvelope(secondary, sEnv);
    mixMono(out, secondary, 0.3);
    normalize(out, 0.9);
    return out;
}

function renderWoodblock(): Float32Array {
    const dur = 0.09;
    const out = createMono(dur);
    const body = renderFmOscillator(dur, 1800, 5400, 2);
    const env = renderEnvelope(dur, { attack: 0.0005, release: 0.08, curve: 'exp' });
    applyEnvelope(body, env);
    mixMono(out, body, 0.85);
    biquad(out, { type: 'bandpass', freq: 1700, q: 1.2 });
    normalize(out, 0.88);
    return out;
}

function renderTriangleBell(): Float32Array {
    const dur = 1.2;
    const out = createMono(dur);
    // Inharmonic triangle = several non-integer partials.
    const partials = [3200, 4900, 6350, 8800, 11200];
    const amps = [0.5, 0.35, 0.25, 0.15, 0.1];
    for (let p = 0; p < partials.length; p++) {
        const s = renderSine(dur, partials[p]!);
        const env = renderEnvelope(dur, { attack: 0.001, release: dur * (0.5 + 0.1 * p), curve: 'exp' });
        applyEnvelope(s, env);
        mixMono(out, s, amps[p]!);
    }
    normalize(out, 0.85);
    return out;
}

export function generateWorldPerc(ctx: AudioContext): FactorySample[] {
    const base = 'factory-world-perc';
    const tags = ['world', 'percussion', 'acoustic'];
    return [
        { id: `${base}-tabla`, name: 'Tabla Na', render: renderTabla, extra: ['tabla', 'indian'] },
        { id: `${base}-bongo`, name: 'Bongo Hit', render: renderBongo, extra: ['bongo', 'latin'] },
        { id: `${base}-djembe`, name: 'Djembe Tone', render: renderDjembe, extra: ['djembe', 'african'] },
        { id: `${base}-shaker`, name: 'Shaker', render: renderShaker, extra: ['shaker'] },
        { id: `${base}-agogo`, name: 'Agogo Bell', render: renderAgogo, extra: ['agogo', 'bell'] },
        { id: `${base}-claves`, name: 'Claves', render: renderClaves, extra: ['claves'] },
        { id: `${base}-woodblock`, name: 'Woodblock', render: renderWoodblock, extra: ['woodblock'] },
        { id: `${base}-triangle`, name: 'Triangle', render: renderTriangleBell, extra: ['triangle', 'bell'] },
    ].map((s) => ({
        id: s.id,
        name: s.name,
        category: 'drums' as const,
        tags: [...tags, ...s.extra],
        buffer: toAudioBufferMono(ctx, s.render()),
    }));
}
