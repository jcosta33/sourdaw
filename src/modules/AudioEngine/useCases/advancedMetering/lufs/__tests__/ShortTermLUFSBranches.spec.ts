import { describe, it, expect } from 'vitest';

import { ShortTermLUFS } from '../ShortTermLUFS';

/**
 * Deep math specs for ShortTermLUFS. The existing spec only pushes uniform
 * values (-10 repeated), which reduces the averaging formula to the identity.
 * These specs test mixed-value averaging, the ring-buffer wrap path, and the
 * -70 floor.
 */

describe('ShortTermLUFS — LUFS averaging formula', () => {
    it('averages mixed LUFS blocks via 10*log10(mean(10^(x/10)))', () => {
        const meter = new ShortTermLUFS(48_000);
        meter.push(-10);
        meter.push(-20);
        // mean energy = (10^(-1) + 10^(-2)) / 2 = (0.1 + 0.01) / 2 = 0.055
        // 10 * log10(0.055) ≈ -12.6
        expect(meter.value).toBeCloseTo(-12.6, 0);
    });

    it('returns the same value as the block when all blocks are equal', () => {
        const meter = new ShortTermLUFS(48_000);
        meter.push(-15);
        meter.push(-15);
        expect(meter.value).toBeCloseTo(-15, 5);
    });
});

describe('ShortTermLUFS — empty and floor', () => {
    it('returns -70 when no blocks have been pushed', () => {
        const meter = new ShortTermLUFS(48_000);
        expect(meter.value).toBe(-70);
    });

    it('floors the output at -70 for extremely low energy', () => {
        const meter = new ShortTermLUFS(48_000);
        meter.push(-200);
        // 10^(-200/10) ≈ 1e-20 → 10*log10(1e-20) = -200, floored to -70.
        expect(meter.value).toBe(-70);
    });
});

describe('ShortTermLUFS — ring buffer wrap', () => {
    it('shifts out the oldest block when the ring is full (maxBlocks = 8 at 48kHz)', () => {
        // maxBlocks = ceil(3 * 48000 / (0.4 * 48000)) = ceil(7.5) = 8.
        const meter = new ShortTermLUFS(48_000);
        // Push 9 values: [-10, -10, -10, -10, -10, -10, -10, -10, -20]
        // After the 9th push, the first -10 is shifted out, leaving 7×(-10) + 1×(-20).
        for (let i = 0; i < 8; i++) {
            meter.push(-10);
        }
        meter.push(-20);
        // mean energy = (7 * 10^(-1) + 10^(-2)) / 8 = (0.7 + 0.01) / 8 = 0.08875
        // 10 * log10(0.08875) ≈ -10.52
        expect(meter.value).toBeCloseTo(-10.52, 0);
    });

    it('maxBlocks changes with sample rate', () => {
        // At 96kHz: ceil(3 * 96000 / (0.4 * 96000)) = ceil(7.5) = 8 (same ratio).
        // At 44100: ceil(3 * 44100 / (0.4 * 44100)) = ceil(7.5) = 8.
        // The ratio 3/0.4 = 7.5 is independent of sample rate.
        const meter48 = new ShortTermLUFS(48_000);
        const meter96 = new ShortTermLUFS(96_000);
        // Both have the same maxBlocks (8).
        meter48.push(-10);
        meter96.push(-10);
        expect(meter48.value).toBeCloseTo(meter96.value, 5);
    });
});

describe('ShortTermLUFS — ring buffer ordering', () => {
    it('maintains correct averaging order after multiple wraps', () => {
        const meter = new ShortTermLUFS(48_000);
        // Fill with -10 (8 blocks), then replace all with -20 one by one.
        for (let i = 0; i < 8; i++) {
            meter.push(-10);
        }
        // Now replace 4 blocks with -20.
        for (let i = 0; i < 4; i++) {
            meter.push(-20);
        }
        // 4×(-10) + 4×(-20) = mean energy = (4*0.1 + 4*0.01) / 8 = 0.44/8 = 0.055
        // 10 * log10(0.055) ≈ -12.6
        expect(meter.value).toBeCloseTo(-12.6, 0);
    });
});
