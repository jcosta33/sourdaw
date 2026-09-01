import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const advanceSetlistItemEndMock = vi.hoisted(() => vi.fn());

vi.mock('../advanceSetlistItemEnd', () => ({
    advanceSetlistItemEnd: advanceSetlistItemEndMock,
}));

describe('startSetlistItemEndObserver', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
    });

    beforeEach(() => {
        vi.resetModules();
        rafCallbacks.length = 0;
        requestAnimationFrameMock.mockClear();
        advanceSetlistItemEndMock.mockClear();
        vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    async function loadStartObserver(): Promise<() => void> {
        const module = await import('../startSetlistItemEndObserver');
        return module.startSetlistItemEndObserver;
    }

    it('schedules a requestAnimationFrame loop on first start', async () => {
        const startSetlistItemEndObserver = await loadStartObserver();

        startSetlistItemEndObserver();

        expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    });

    it('is idempotent and schedules only one animation frame loop', async () => {
        const startSetlistItemEndObserver = await loadStartObserver();

        startSetlistItemEndObserver();
        startSetlistItemEndObserver();

        expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    });

    it('invokes advanceSetlistItemEnd from the animation frame loop body', async () => {
        const startSetlistItemEndObserver = await loadStartObserver();

        startSetlistItemEndObserver();
        advanceSetlistItemEndMock.mockClear();

        rafCallbacks[0]?.(0);

        expect(advanceSetlistItemEndMock).toHaveBeenCalledTimes(1);
    });
});
