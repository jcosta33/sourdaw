import {
    applyEnvelope,
    biquadSweep,
    createStereo,
    mixMonoIntoStereo,
    normalizeStereo,
    renderEnvelope,
    renderNoise,
    renderSine,
    softClipStereo,
    toAudioBufferStereo,
    SAMPLE_RATE,
} from './synthesis';
import { type FactorySample } from './types';

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
        const body = renderSine(dur, (t) => base * (1 + 2 * (t / dur) ** 2));
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
    const sweep = renderSine(dur, (t) => 200 * 20 ** (t / dur));
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
        const a = t ** 2;
        left[i]! *= a;
        right[i]! *= a;
    }

    mixMonoIntoStereo(out, left, 0.9, -0.5);
    mixMonoIntoStereo(out, right, 0.9, 0.5);
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
