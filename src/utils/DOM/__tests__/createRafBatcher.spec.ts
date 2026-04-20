import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createRafBatcher } from '../createRafBatcher';

describe('createRafBatcher', () => {
    const rafCallbacks: FrameRequestCallback[] = [];

    beforeEach(() => {
        rafCallbacks.length = 0;
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should coalesce multiple schedules for the same key and flush the last value', () => {
        const batcher = createRafBatcher<number>();
        const flush = vi.fn();
        batcher.schedule('k', 1, flush);
        batcher.schedule('k', 2, flush);
        expect(batcher.pendingSize).toBe(1);
        rafCallbacks[0]?.(0);
        expect(flush).toHaveBeenCalledTimes(1);
        expect(flush).toHaveBeenCalledWith('k', 2);
        expect(batcher.pendingSize).toBe(0);
    });

    it('should schedule separate rAF entries for different keys', () => {
        const batcher = createRafBatcher<string>();
        const flushA = vi.fn();
        const flushB = vi.fn();
        batcher.schedule('a', 'x', flushA);
        batcher.schedule('b', 'y', flushB);
        expect(batcher.pendingSize).toBe(2);
        expect(rafCallbacks).toHaveLength(2);
        rafCallbacks[0]?.(0);
        rafCallbacks[1]?.(0);
        expect(flushA).toHaveBeenCalledWith('a', 'x');
        expect(flushB).toHaveBeenCalledWith('b', 'y');
        expect(batcher.pendingSize).toBe(0);
    });

    it('should not flush after cancel', () => {
        const batcher = createRafBatcher<number>();
        const flush = vi.fn();
        batcher.schedule('k', 1, flush);
        batcher.cancel('k');
        expect(batcher.pendingSize).toBe(0);
        rafCallbacks[0]?.(0);
        expect(flush).not.toHaveBeenCalled();
    });

    it('should clear all pending entries on cancelAll', () => {
        const batcher = createRafBatcher<number>();
        batcher.schedule('a', 1, vi.fn());
        batcher.schedule('b', 2, vi.fn());
        batcher.cancelAll();
        expect(batcher.pendingSize).toBe(0);
    });
});
