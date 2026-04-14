import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { yieldToMain } from '../yieldToMain';

describe('yieldToMain', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should resolve after a macrotask via setTimeout(0)', async () => {
        const promise = yieldToMain();
        let settled = false;
        void promise.then(() => {
            settled = true;
        });
        expect(settled).toBe(false);
        await vi.runAllTimersAsync();
        expect(settled).toBe(true);
    });
});
