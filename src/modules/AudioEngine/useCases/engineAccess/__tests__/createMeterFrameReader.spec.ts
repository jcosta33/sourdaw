import { describe, expect, it, vi } from 'vitest';

import { createMeterFrameReader } from '../createMeterFrameReader';

describe('createMeterFrameReader', () => {
    it('shares a consumed value only within the exact frame and channel', () => {
        const peaks = new Map([
            ['a', 0.5],
            ['b', 0.25],
        ]);
        const producer = vi.fn((key: string) => {
            const peak = peaks.get(key) ?? 0;
            peaks.set(key, 0);
            return peak;
        });
        const read = createMeterFrameReader(producer);
        expect(read('a', 1.01)).toBe(0.5);
        expect(read('b', 1.01)).toBe(0.25);
        expect(read('a', 1.01)).toBe(0.5);
        expect(producer).toHaveBeenCalledTimes(2);
        expect(read('a', 1.02)).toBe(0);
        expect(read('b', 1.02)).toBe(0);
        expect(producer).toHaveBeenCalledTimes(4);
    });

    it('keeps immediate queries destructive without changing the shared frame reading', () => {
        let peak = 0.75;
        const read = createMeterFrameReader(() => {
            const result = peak;
            peak = 0;
            return result;
        });
        expect(read('master', 10)).toBe(0.75);
        peak = 0.25;
        expect(read('master')).toBe(0.25);
        expect(read('master')).toBe(0);
        expect(read('master', 10)).toBe(0.75);
        expect(read('master', 11)).toBe(0);
    });

    it('retains null, measured zero and overflow exactly and refreshes each next frame', () => {
        let value: number | null = null;
        const read = createMeterFrameReader(() => value);
        expect(read('master', 0)).toBeNull();
        value = 0;
        expect(read('master', 0)).toBeNull();
        expect(read('master', 1)).toBe(0);
        value = Number.POSITIVE_INFINITY;
        expect(read('master', 2)).toBe(Number.POSITIVE_INFINITY);
    });

    it('forgets channels from every previous frame rather than accumulating historical entries', () => {
        const producer = vi.fn((key: number) => key);
        const read = createMeterFrameReader(producer);
        for (let frame = 0; frame < 20; frame++) {
            expect(read(frame, frame)).toBe(frame);
        }
        expect(read(0, 19)).toBe(0);
        expect(producer).toHaveBeenCalledTimes(21);
    });

    it('does not cache failures or non-finite frame identifiers', () => {
        const producer = vi
            .fn(() => 0.5)
            .mockImplementationOnce(() => {
                throw new Error('meter failed');
            });
        const read = createMeterFrameReader(producer);
        expect(() => read('a', 12)).toThrow('meter failed');
        expect(read('a', 12)).toBe(0.5);
        expect(read('a', Number.NaN)).toBe(0.5);
        expect(read('a', Number.NaN)).toBe(0.5);
        expect(producer).toHaveBeenCalledTimes(4);
    });
});
