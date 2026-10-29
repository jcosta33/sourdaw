import { describe, expect, it } from 'vitest';

import { detectTransients } from '../TransientDetection';

function impulses() {
    const samples = new Float32Array(65_536);
    for (const offset of [8_192, 24_576, 40_960, 57_344]) {
        for (let index = 0; index < 80; index++) {
            samples[offset + index] = Math.cos(index * 1.723) * Math.exp(-index / 20);
        }
    }
    return samples;
}

describe('pure spectral-flux source detector', () => {
    it('returns four ascending source offsets with bounded confidence without changing the input', () => {
        const samples = impulses();
        const before = new Float32Array(samples);
        const hits = detectTransients(samples, 16_000, 0.5);
        expect(hits).toHaveLength(4);
        for (const [index, hit] of hits.entries()) {
            expect(Math.abs(hit.sampleOffset - [8_192, 24_576, 40_960, 57_344][index]!)).toBeLessThanOrEqual(2_048);
            expect(hit.sampleOffset).toBeGreaterThan(hits[index - 1]?.sampleOffset ?? -1);
            expect(hit.confidence).toBeGreaterThan(0);
            expect(hit.confidence).toBeLessThanOrEqual(1);
        }
        expect(samples).toEqual(before);
        expect(hits.some((hit) => hit.confidence === 1)).toBe(true);
    });

    it('keeps one global threshold rather than treating quiet segments as independent sources', () => {
        const samples = impulses();
        const split = samples.length / 2;
        for (let frame = split; frame < samples.length; frame++) {
            samples[frame] = samples[frame]! * 0.001;
        }
        expect(detectTransients(samples, 16_000, 0.5)).toHaveLength(2);
        expect(detectTransients(samples.slice(split), 16_000, 0.5)).toHaveLength(2);
    });

    it('returns no hits for silence or a source shorter than one FFT window', () => {
        expect(detectTransients(new Float32Array(65_536), 16_000, 0.5)).toEqual([]);
        expect(detectTransients(new Float32Array(2_047), 16_000, 0.5)).toEqual([]);
    });
});

// Captured from the committed detector at 84499e9 before the performance change.
// Fixed outputs exercise the numerical contract without carrying a second FFT implementation.
function fixture(kind: string): Float32Array {
    let length = 32768;
    if (kind === 'short') {
        length = 2047;
    } else if (kind === 'window') {
        length = 2048;
    }
    const samples = new Float32Array(length);
    let seed = 0x4630;
    for (let index = 0; index < samples.length; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = (seed / 0x100000000) * 2 - 1;
        if (kind === 'dense') {
            samples[index] = noise * 0.4 + Math.sin(index * 0.371) * 0.3;
        }
        if (kind === 'quiet') {
            samples[index] = noise * 1e-37;
        }
        if (
            kind === 'boundaries' &&
            [0, 1, 511, 512, 2047, 2048, 2559, 2560, 4095, 4096, 8192, 16383, 16384, 32767].includes(index)
        ) {
            samples[index] = noise;
        }
        if (
            kind === 'gaps' &&
            ((index >= 3072 && index < 4096) || (index >= 12288 && index < 13312) || (index >= 24576 && index < 25600))
        ) {
            samples[index] = noise * (index < 16384 ? 0.8 : 0.08);
        }
    }
    return samples;
}

const committedGoldens = [
    { kind: 'silence', sampleRate: 48000, sensitivity: 0, hits: [] },
    { kind: 'silence', sampleRate: 48000, sensitivity: 0.5, hits: [] },
    { kind: 'silence', sampleRate: 48000, sensitivity: 0.82, hits: [] },
    { kind: 'silence', sampleRate: 48000, sensitivity: 1, hits: [] },
    { kind: 'short', sampleRate: 48000, sensitivity: 0, hits: [] },
    { kind: 'short', sampleRate: 48000, sensitivity: 0.5, hits: [] },
    { kind: 'short', sampleRate: 48000, sensitivity: 0.82, hits: [] },
    { kind: 'short', sampleRate: 48000, sensitivity: 1, hits: [] },
    { kind: 'window', sampleRate: 48000, sensitivity: 0, hits: [] },
    { kind: 'window', sampleRate: 48000, sensitivity: 0.5, hits: [] },
    { kind: 'window', sampleRate: 48000, sensitivity: 0.82, hits: [] },
    { kind: 'window', sampleRate: 48000, sensitivity: 1, hits: [] },
    { kind: 'dense', sampleRate: 44100, sensitivity: 0, hits: [] },
    { kind: 'dense', sampleRate: 44100, sensitivity: 0.5, hits: [] },
    {
        kind: 'dense',
        sampleRate: 44100,
        sensitivity: 0.82,
        hits: [
            { sampleOffset: 1536, confidence: 0.2249617480195074 },
            { sampleOffset: 3072, confidence: 0.21032079011469854 },
            { sampleOffset: 5632, confidence: 0.2183346443585207 },
            { sampleOffset: 7168, confidence: 0.2178623585864364 },
            { sampleOffset: 8704, confidence: 0.2241220452943037 },
            { sampleOffset: 10240, confidence: 0.22772438225773184 },
            { sampleOffset: 11776, confidence: 0.21666266167276257 },
            { sampleOffset: 14336, confidence: 0.22324223984595487 },
            { sampleOffset: 16384, confidence: 0.21298306857486482 },
            { sampleOffset: 18944, confidence: 0.20329697432277666 },
            { sampleOffset: 20480, confidence: 0.22368356774094195 },
            { sampleOffset: 23040, confidence: 0.22294287479914 },
            { sampleOffset: 24576, confidence: 0.2256974924515432 },
            { sampleOffset: 26624, confidence: 0.21975605430375852 },
            { sampleOffset: 28160, confidence: 0.22402845907760569 },
        ],
    },
    {
        kind: 'dense',
        sampleRate: 44100,
        sensitivity: 1,
        hits: [
            { sampleOffset: 1536, confidence: 0.2249617480195074 },
            { sampleOffset: 3072, confidence: 0.21032079011469854 },
            { sampleOffset: 5632, confidence: 0.2183346443585207 },
            { sampleOffset: 7168, confidence: 0.2178623585864364 },
            { sampleOffset: 8704, confidence: 0.2241220452943037 },
            { sampleOffset: 10240, confidence: 0.22772438225773184 },
            { sampleOffset: 11776, confidence: 0.21666266167276257 },
            { sampleOffset: 14336, confidence: 0.22324223984595487 },
            { sampleOffset: 16384, confidence: 0.21298306857486482 },
            { sampleOffset: 18944, confidence: 0.20329697432277666 },
            { sampleOffset: 20480, confidence: 0.22368356774094195 },
            { sampleOffset: 23040, confidence: 0.22294287479914 },
            { sampleOffset: 24576, confidence: 0.2256974924515432 },
            { sampleOffset: 26624, confidence: 0.21975605430375852 },
            { sampleOffset: 28160, confidence: 0.22402845907760569 },
        ],
    },
    { kind: 'quiet', sampleRate: 8000, sensitivity: 0, hits: [] },
    { kind: 'quiet', sampleRate: 8000, sensitivity: 0.5, hits: [] },
    {
        kind: 'quiet',
        sampleRate: 8000,
        sensitivity: 0.82,
        hits: [
            { sampleOffset: 1536, confidence: 0.23317765250847086 },
            { sampleOffset: 3072, confidence: 0.22161708904436428 },
            { sampleOffset: 4096, confidence: 0.23377961068650158 },
            { sampleOffset: 5632, confidence: 0.22679117148342154 },
            { sampleOffset: 7168, confidence: 0.22815204800251113 },
            { sampleOffset: 8704, confidence: 0.23334418436215468 },
            { sampleOffset: 10240, confidence: 0.236715396065976 },
            { sampleOffset: 11776, confidence: 0.2263276059449195 },
            { sampleOffset: 12800, confidence: 0.22791698906922264 },
            { sampleOffset: 14336, confidence: 0.23351038937762097 },
            { sampleOffset: 15360, confidence: 0.22523545269552195 },
            { sampleOffset: 16384, confidence: 0.222978961641831 },
            { sampleOffset: 17408, confidence: 0.23727719983442688 },
            { sampleOffset: 19456, confidence: 0.21168514485438672 },
            { sampleOffset: 20480, confidence: 0.23169125455013273 },
            { sampleOffset: 23040, confidence: 0.23315441586757835 },
            { sampleOffset: 24576, confidence: 0.23556904992737032 },
            { sampleOffset: 25600, confidence: 0.22279082733834224 },
            { sampleOffset: 26624, confidence: 0.2298707345511512 },
            { sampleOffset: 27648, confidence: 0.231325771604333 },
        ],
    },
    {
        kind: 'quiet',
        sampleRate: 8000,
        sensitivity: 1,
        hits: [
            { sampleOffset: 1536, confidence: 0.23317765250847086 },
            { sampleOffset: 3072, confidence: 0.22161708904436428 },
            { sampleOffset: 4096, confidence: 0.23377961068650158 },
            { sampleOffset: 5632, confidence: 0.22679117148342154 },
            { sampleOffset: 7168, confidence: 0.22815204800251113 },
            { sampleOffset: 8704, confidence: 0.23334418436215468 },
            { sampleOffset: 10240, confidence: 0.236715396065976 },
            { sampleOffset: 11776, confidence: 0.2263276059449195 },
            { sampleOffset: 12800, confidence: 0.22791698906922264 },
            { sampleOffset: 14336, confidence: 0.23351038937762097 },
            { sampleOffset: 15360, confidence: 0.22523545269552195 },
            { sampleOffset: 16384, confidence: 0.222978961641831 },
            { sampleOffset: 17408, confidence: 0.23727719983442688 },
            { sampleOffset: 19456, confidence: 0.21168514485438672 },
            { sampleOffset: 20480, confidence: 0.23169125455013273 },
            { sampleOffset: 23040, confidence: 0.23315441586757835 },
            { sampleOffset: 24576, confidence: 0.23556904992737032 },
            { sampleOffset: 25600, confidence: 0.22279082733834224 },
            { sampleOffset: 26624, confidence: 0.2298707345511512 },
            { sampleOffset: 27648, confidence: 0.231325771604333 },
        ],
    },
    {
        kind: 'boundaries',
        sampleRate: 48000,
        sensitivity: 0,
        hits: [
            { sampleOffset: 1024, confidence: 1 },
            { sampleOffset: 3072, confidence: 0.9100258994043341 },
            { sampleOffset: 14848, confidence: 0.6757043308556692 },
        ],
    },
    {
        kind: 'boundaries',
        sampleRate: 48000,
        sensitivity: 0.5,
        hits: [
            { sampleOffset: 1024, confidence: 1 },
            { sampleOffset: 3072, confidence: 0.9100258994043341 },
            { sampleOffset: 7168, confidence: 0.31325550066086566 },
            { sampleOffset: 14848, confidence: 0.6757043308556692 },
        ],
    },
    {
        kind: 'boundaries',
        sampleRate: 48000,
        sensitivity: 0.82,
        hits: [
            { sampleOffset: 1024, confidence: 1 },
            { sampleOffset: 3072, confidence: 0.9100258994043341 },
            { sampleOffset: 7168, confidence: 0.31325550066086566 },
            { sampleOffset: 14848, confidence: 0.6757043308556692 },
        ],
    },
    {
        kind: 'boundaries',
        sampleRate: 48000,
        sensitivity: 1,
        hits: [
            { sampleOffset: 1024, confidence: 1 },
            { sampleOffset: 3072, confidence: 0.9100258994043341 },
            { sampleOffset: 7168, confidence: 0.31325550066086566 },
            { sampleOffset: 14848, confidence: 0.6757043308556692 },
        ],
    },
    {
        kind: 'gaps',
        sampleRate: 48000,
        sensitivity: 0,
        hits: [
            { sampleOffset: 2048, confidence: 0.9985649338984487 },
            { sampleOffset: 11264, confidence: 1 },
        ],
    },
    {
        kind: 'gaps',
        sampleRate: 48000,
        sensitivity: 0.5,
        hits: [
            { sampleOffset: 2048, confidence: 0.9985649338984487 },
            { sampleOffset: 11264, confidence: 1 },
        ],
    },
    {
        kind: 'gaps',
        sampleRate: 48000,
        sensitivity: 0.82,
        hits: [
            { sampleOffset: 2048, confidence: 0.9985649338984487 },
            { sampleOffset: 11264, confidence: 1 },
        ],
    },
    {
        kind: 'gaps',
        sampleRate: 48000,
        sensitivity: 1,
        hits: [
            { sampleOffset: 2048, confidence: 0.9985649338984487 },
            { sampleOffset: 11264, confidence: 1 },
            { sampleOffset: 23552, confidence: 0.09766664534340969 },
        ],
    },
] as const;

describe('unchanged committed onset positions and confidence', () => {
    it.each(committedGoldens)('$kind at sensitivity $sensitivity', ({ kind, sampleRate, sensitivity, hits }) => {
        expect(detectTransients(fixture(kind), sampleRate, sensitivity)).toEqual(hits);
    });
});
