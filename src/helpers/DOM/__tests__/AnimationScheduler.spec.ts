import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { animationScheduler } from '../AnimationScheduler';

describe('animationScheduler', () => {
    beforeEach(() => {
        vi.spyOn(globalThis.performance, 'now').mockReturnValue(1000);
        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            queueMicrotask(() => {
                cb(1000 as DOMHighResTimeStamp);
            });
            return 1;
        });
        vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should invoke a registered callback with time and delta', async () => {
        const fn = vi.fn(() => {
            animationScheduler.unregister('a');
        });
        animationScheduler.register('a', fn);
        await Promise.resolve();
        expect(fn).toHaveBeenCalledOnce();
        expect(fn.mock.calls[0][0]).toBe(1000);
        expect(fn.mock.calls[0][1]).toBe(0);
    });

    it('should cancel the animation frame when the last callback unregisters', async () => {
        const fn = vi.fn(() => {
            animationScheduler.unregister('b');
        });
        animationScheduler.register('b', fn);
        await Promise.resolve();
        expect(fn).toHaveBeenCalledOnce();
        expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
    });

    it('should continue invoking other callbacks when one throws', async () => {
        const good = vi.fn(() => {
            animationScheduler.unregister('bad');
            animationScheduler.unregister('good');
        });
        animationScheduler.register('bad', () => {
            throw new Error('boom');
        });
        animationScheduler.register('good', good);
        await Promise.resolve();
        expect(good).toHaveBeenCalledOnce();
        expect(console.error).toHaveBeenCalled();
    });
});
