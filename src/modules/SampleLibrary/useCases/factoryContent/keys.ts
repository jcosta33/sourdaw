import {
    applyEnvelope,
    biquad,
    createMono,
    feedbackDelay,
    mixMono,
    normalize,
    renderEnvelope,
    renderFmOscillator,
    renderSaw,
    renderSine,
    renderTriangle,
    softClip,
    toAudioBufferMono,
    midiToFreq,
} from './synthesis';
import { type FactorySample } from './types';

const C3 = 48;
const C3_FREQ = midiToFreq(C3);

function renderRhodes(): Float32Array {
    const dur = 2.5;
    const out = createMono(dur);
    // Classic Rhodes = FM (sine × sine) with low mod index for the bell attack.
    const body = renderFmOscillator(dur, C3_FREQ, C3_FREQ, (t) => 4 * Math.exp(-t * 3));
    const env = renderEnvelope(dur, {
        attack: 0.003,
        decay: 0.3,
        sustainLevel: 0.5,
        sustain: 0.8,
        release: 1.3,
        curve: 'exp',
    });
    applyEnvelope(body, env);
    mixMono(out, body, 0.9);

    const sub = renderSine(dur, C3_FREQ * 0.5);
    const sEnv = renderEnvelope(dur, {
        attack: 0.005,
        decay: 0.3,
        sustainLevel: 0.4,
        sustain: 0.6,
        release: 1.2,
        curve: 'exp',
    });
    applyEnvelope(sub, sEnv);
    mixMono(out, sub, 0.2);
    biquad(out, { type: 'lowpass', freq: 4500, q: 0.7 });
    normalize(out, 0.9);
    return out;
}

function renderFmBell(): Float32Array {
    const dur = 2.0;
    const out = renderFmOscillator(dur, C3_FREQ, C3_FREQ * 3.5, (t) => 6 * Math.exp(-t * 2));
    const env = renderEnvelope(dur, {
        attack: 0.002,
        decay: 0.15,
        sustainLevel: 0.4,
        sustain: 0.5,
        release: 1.3,
        curve: 'exp',
    });
    applyEnvelope(out, env);
    normalize(out, 0.88);
    return out;
}

function renderPluck(): Float32Array {
    const dur = 1.0;
    const out = renderSaw(dur, C3_FREQ);
    biquad(out, { type: 'lowpass', freq: 2500, q: 2 });
    const env = renderEnvelope(dur, {
        attack: 0.001,
        decay: 0.2,
        sustainLevel: 0.15,
        sustain: 0,
        release: 0.8,
        curve: 'exp',
    });
    applyEnvelope(out, env);
    feedbackDelay(out, 0.15, 0.35, 0.2);
    normalize(out, 0.85);
    return out;
}

function renderStab(): Float32Array {
    const dur = 0.6;
    const out = createMono(dur);
    const a = renderSaw(dur, C3_FREQ);
    const b = renderSaw(dur, C3_FREQ * 2 ** (4 / 12));
    const c = renderSaw(dur, C3_FREQ * 2 ** (7 / 12));
    mixMono(out, a, 0.4);
    mixMono(out, b, 0.35);
    mixMono(out, c, 0.35);
    biquad(out, { type: 'lowpass', freq: 2800, q: 1.5 });
    const env = renderEnvelope(dur, {
        attack: 0.003,
        decay: 0.1,
        sustainLevel: 0.3,
        sustain: 0,
        release: 0.5,
        curve: 'exp',
    });
    applyEnvelope(out, env);
    softClip(out, 1.15);
    normalize(out, 0.88);
    return out;
}

function renderOrganHit(): Float32Array {
    const dur = 1.2;
    const out = createMono(dur);
    // Drawbar-style stack: fundamental + octave + fifth + two octaves + major third.
    const partials = [1, 2, 3, 4, 5];
    const amps = [0.35, 0.3, 0.2, 0.15, 0.1];
    for (let p = 0; p < partials.length; p++) {
        const s = renderSine(dur, C3_FREQ * partials[p]!);
        mixMono(out, s, amps[p]!);
    }
    const env = renderEnvelope(dur, {
        attack: 0.005,
        decay: 0.05,
        sustainLevel: 0.85,
        sustain: 0.8,
        release: 0.3,
        curve: 'linear',
    });
    applyEnvelope(out, env);
    normalize(out, 0.88);
    return out;
}

function renderSupersaw(): Float32Array {
    const dur = 1.5;
    const out = createMono(dur);
    // Seven detuned saws = supersaw.
    const detunes = [-0.015, -0.01, -0.005, 0, 0.005, 0.01, 0.015];
    for (const d of detunes) {
        const s = renderSaw(dur, C3_FREQ * (1 + d));
        mixMono(out, s, 1 / detunes.length);
    }
    biquad(out, { type: 'lowpass', freq: 3000, q: 0.9 });
    const env = renderEnvelope(dur, {
        attack: 0.02,
        decay: 0.1,
        sustainLevel: 0.8,
        sustain: 0.9,
        release: 0.4,
        curve: 'exp',
    });
    applyEnvelope(out, env);
    // A few triangle sub-octaves give the supersaw its body.
    const sub = renderTriangle(dur, C3_FREQ * 0.5);
    const sEnv = renderEnvelope(dur, {
        attack: 0.02,
        decay: 0.1,
        sustainLevel: 0.6,
        sustain: 0.9,
        release: 0.4,
        curve: 'exp',
    });
    applyEnvelope(sub, sEnv);
    mixMono(out, sub, 0.2);
    normalize(out, 0.88);
    return out;
}

export function generateKeysPack(ctx: AudioContext): FactorySample[] {
    const base = 'factory-keys';
    const tags = ['keys', 'melodic'];
    return [
        { id: `${base}-rhodes`, name: 'Rhodes C3', render: renderRhodes, extra: ['rhodes', 'ep'] },
        { id: `${base}-fm-bell`, name: 'FM Bell C3', render: renderFmBell, extra: ['fm', 'bell'] },
        { id: `${base}-pluck`, name: 'Pluck C3', render: renderPluck, extra: ['pluck'] },
        { id: `${base}-stab`, name: 'Chord Stab C3', render: renderStab, extra: ['stab', 'chord'] },
        { id: `${base}-organ`, name: 'Organ Hit C3', render: renderOrganHit, extra: ['organ'] },
        { id: `${base}-supersaw`, name: 'Supersaw C3', render: renderSupersaw, extra: ['supersaw', 'lead'] },
    ].map((s) => ({
        id: s.id,
        name: s.name,
        category: 'keys' as const,
        tags: [...tags, ...s.extra],
        pitch: C3,
        buffer: toAudioBufferMono(ctx, s.render()),
    }));
}
