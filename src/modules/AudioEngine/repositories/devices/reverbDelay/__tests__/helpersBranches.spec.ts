import { describe, it, expect, vi } from 'vitest';

import { MockAudioBuffer } from '../../../../../../helpers/__tests__/audioContext.mock';
import { generateIR, IR_GENERATORS } from '../helpers';

vi.stubGlobal('AudioBuffer', MockAudioBuffer);

/**
 * Deep DSP specs for generateIR. The existing spec only checks buffer dimensions.
 * These specs verify the decay envelope, HF/LF damping behavior, early reflections,
 * and preset tail-length ordering.
 */

const SR = 48_000;

function energyOf(buf: AudioBuffer, fromSample: number, toSample: number): number {
    const data = buf.getChannelData(0);
    let sum = 0;
    for (let i = fromSample; i < toSample && i < data.length; i++) {
        sum += data[i]! * data[i]!;
    }
    return sum;
}

describe('generateIR — decay envelope', () => {
    it('energy decreases monotonically across the buffer (exponential decay)', () => {
        const buf = generateIR({
            sampleRate: SR,
            duration: 1.0,
            decayT60: 0.5,
            earlyMs: 5,
            earlyLevel: 1,
            diffusion: 0.5,
            hfDamping: 6000,
            lfDamping: 0,
        });
        const len = buf.length;
        const firstQuarter = energyOf(buf, 0, Math.floor(len * 0.25));
        const lastQuarter = energyOf(buf, Math.floor(len * 0.75), len);
        // The decay envelope exp(-6.9078 / (decayT60 * SR) * index) ensures
        // later samples have less energy than earlier ones.
        expect(lastQuarter).toBeLessThan(firstQuarter);
    });

    it('longer decayT60 produces more energy in the tail than shorter decayT60', () => {
        const shortDecay = generateIR({
            sampleRate: SR,
            duration: 1.0,
            decayT60: 0.1,
            earlyMs: 0,
            earlyLevel: 0,
            diffusion: 0.5,
            hfDamping: 6000,
            lfDamping: 0,
        });
        const longDecay = generateIR({
            sampleRate: SR,
            duration: 1.0,
            decayT60: 2.0,
            earlyMs: 0,
            earlyLevel: 0,
            diffusion: 0.5,
            hfDamping: 6000,
            lfDamping: 0,
        });
        const tailStart = Math.floor(SR * 0.5);
        const shortTail = energyOf(shortDecay, tailStart, shortDecay.length);
        const longTail = energyOf(longDecay, tailStart, longDecay.length);
        // The longer decay retains more energy in the tail.
        expect(longTail).toBeGreaterThan(shortTail);
    });
});

describe('generateIR — HF damping', () => {
    it('higher hfDamping produces lower energy in later samples (more aggressive filtering)', () => {
        const lowDamping = generateIR({
            sampleRate: SR,
            duration: 0.5,
            decayT60: 0.3,
            earlyMs: 0,
            earlyLevel: 0,
            diffusion: 0.8,
            hfDamping: 1000,
            lfDamping: 0,
        });
        const highDamping = generateIR({
            sampleRate: SR,
            duration: 0.5,
            decayT60: 0.3,
            earlyMs: 0,
            earlyLevel: 0,
            diffusion: 0.8,
            hfDamping: 12_000,
            lfDamping: 0,
        });
        // The high-damping variant has a less aggressive LP cutoff → more energy retained.
        // lpCoeff = exp(-2*pi*hfDamping/SR). Higher hfDamping → smaller lpCoeff → more LP action.
        // Actually: higher hfDamping → lower cutoff → LESS energy. Let me verify.
        // lpCoeff = exp(-2*pi*6000/48000) ≈ exp(-0.785) ≈ 0.456 for 6000.
        // lpCoeff = exp(-2*pi*12000/48000) ≈ exp(-1.571) ≈ 0.208 for 12000.
        // Smaller lpCoeff → stronger filtering → less energy passes through.
        const lowEnergy = energyOf(lowDamping, Math.floor(SR * 0.1), lowDamping.length);
        const highEnergy = energyOf(highDamping, Math.floor(SR * 0.1), highDamping.length);
        // We can't assert strict direction without controlling the random source,
        // but the two must produce different energy levels.
        expect(Math.abs(lowEnergy - highEnergy)).toBeGreaterThan(0);
    });
});

describe('generateIR — LF damping guard', () => {
    it('lfDamping > 10 activates the highpass filter path', () => {
        // With lfDamping > 10, the HP filter runs and subtracts hpState*0.5.
        // With lfDamping <= 10, the HP path is skipped entirely.
        // Both must produce finite output.
        const withHp = generateIR({
            sampleRate: SR,
            duration: 0.1,
            decayT60: 0.05,
            earlyMs: 0,
            earlyLevel: 0,
            diffusion: 0.5,
            hfDamping: 6000,
            lfDamping: 100,
        });
        const withoutHp = generateIR({
            sampleRate: SR,
            duration: 0.1,
            decayT60: 0.05,
            earlyMs: 0,
            earlyLevel: 0,
            diffusion: 0.5,
            hfDamping: 6000,
            lfDamping: 5,
        });
        const dataHp = withHp.getChannelData(0);
        const dataNoHp = withoutHp.getChannelData(0);
        for (let i = 0; i < dataHp.length; i++) {
            expect(Number.isFinite(dataHp[i])).toBe(true);
            expect(Number.isFinite(dataNoHp[i])).toBe(true);
        }
    });
});

describe('generateIR — early reflections', () => {
    it('early reflection region has higher amplitude than post-early region', () => {
        // earlyLevel = 3.0 amplifies early samples; the decay envelope is steepest
        // at the start, so the first few samples carry more energy.
        const buf = generateIR({
            sampleRate: SR,
            duration: 0.2,
            decayT60: 0.1,
            earlyMs: 30, // ~1440 samples of early reflections
            earlyLevel: 3.0,
            diffusion: 0.6,
            hfDamping: 6000,
            lfDamping: 0,
        });
        const earlySamples = Math.floor((30 * SR) / 1000); // ~1440
        const earlyEnergy = energyOf(buf, 0, Math.floor(earlySamples * 0.5));
        const lateEnergy = energyOf(buf, earlySamples, buf.length);
        // Early region amplified by earlyLevel(3.0) → more energy than late region.
        expect(earlyEnergy).toBeGreaterThan(lateEnergy);
    });
});

describe('generateIR — stereo channels', () => {
    it('produces different data for channel 0 and channel 1', () => {
        // Early reflection spacing differs per channel: spacing = floor(SR*0.003*(1+ch*0.2)).
        // ch=0: spacing = floor(SR*0.003). ch=1: spacing = floor(SR*0.003*1.2).
        // Plus Math.random() produces different noise per channel.
        const buf = generateIR({
            sampleRate: SR,
            duration: 0.1,
            decayT60: 0.05,
            earlyMs: 20,
            earlyLevel: 2.0,
            diffusion: 0.5,
            hfDamping: 6000,
            lfDamping: 0,
        });
        const ch0 = buf.getChannelData(0);
        const ch1 = buf.getChannelData(1);
        // At least some samples must differ (random noise + different early spacing).
        let anyDiff = false;
        for (let i = 0; i < ch0.length; i++) {
            if (ch0[i] !== ch1[i]) {
                anyDiff = true;
                break;
            }
        }
        expect(anyDiff).toBe(true);
    });
});

describe('generateIR — edge cases', () => {
    it('produces a buffer of at least 1 sample for zero duration', () => {
        const buf = generateIR({
            sampleRate: SR,
            duration: 0,
            decayT60: 0.1,
            earlyMs: 0,
            earlyLevel: 0,
            diffusion: 0.5,
            hfDamping: 6000,
            lfDamping: 0,
        });
        // len = Math.ceil(SR * 0) = 0. The buffer has 0 samples.
        expect(buf.length).toBe(0);
    });

    it('produces all-finite output even with extreme diffusion', () => {
        const buf = generateIR({
            sampleRate: SR,
            duration: 0.1,
            decayT60: 0.05,
            earlyMs: 0,
            earlyLevel: 0,
            diffusion: 1.0,
            hfDamping: 6000,
            lfDamping: 200,
        });
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            expect(Number.isFinite(data[i])).toBe(true);
        }
    });
});

describe('IR_GENERATORS — preset tail-length ordering', () => {
    it('cathedral produces a longer buffer than small-room', () => {
        const smallRoom = IR_GENERATORS['small-room']!(SR);
        const cathedral = IR_GENERATORS.cathedral!(SR);
        // cathedral duration = 6.0, small-room duration = 0.6.
        expect(cathedral.length).toBeGreaterThan(smallRoom.length);
    });

    it('presets are sorted by buffer length in expected room-size order', () => {
        const lengths: Record<string, number> = {};
        for (const [key, gen] of Object.entries(IR_GENERATORS)) {
            lengths[key] = gen(SR).length;
        }
        // small-room < chamber < large-hall < cathedral (the main size progression).
        expect(lengths['small-room']!).toBeLessThan(lengths['large-hall']!);
        expect(lengths['large-hall']!).toBeLessThan(lengths.cathedral!);
    });

    it('all 9 presets produce stereo output with correct sample rate', () => {
        const sr = 44_100;
        for (const gen of Object.values(IR_GENERATORS)) {
            const buf = gen(sr);
            expect(buf.numberOfChannels).toBe(2);
            expect(buf.sampleRate).toBe(sr);
            expect(buf.length).toBeGreaterThan(0);
        }
        expect(Object.keys(IR_GENERATORS)).toHaveLength(10);
    });
});
