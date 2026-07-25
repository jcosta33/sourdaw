import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Drive the real instrumented schedulerWorker module (not a string-eval of its
// source) so V8 coverage attributes execution to schedulerWorker.ts. The worker
// assigns `self.onmessage` and uses the global setInterval/clearInterval, so we
// stub those on `self` (=== globalThis in jsdom) before importing.

type TickMsg = { type: 'tick' };

describe('schedulerWorker', () => {
    let postedMessages: TickMsg[];
    let originalPostMessage: typeof self.postMessage;

    beforeEach(() => {
        vi.useFakeTimers();
        postedMessages = [];
        originalPostMessage = self.postMessage.bind(self);
        // The worker posts ticks to `self`; capture them without touching the DOM.
        vi.stubGlobal('postMessage', (msg: TickMsg) => postedMessages.push(msg));
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        self.postMessage = originalPostMessage;
        // Reset the module so the next test re-registers a fresh onmessage and
        // does not inherit a previously-started interval id.
        vi.resetModules();
    });

    async function loadWorker(): Promise<void> {
        // The worker module has no exports (it only registers self.onmessage),
        // so this is a side-effect import. The instrumentation lives in the
        // imported source, which is what gives V8 coverage attribution.
        await import('../../workers/schedulerWorker');
    }

    it('starts an interval that posts a tick every `interval` ms', async () => {
        await loadWorker();
        self.onmessage?.({ data: { type: 'start', interval: 10 } } as MessageEvent);

        expect(postedMessages).toHaveLength(0);
        vi.advanceTimersByTime(10);
        expect(postedMessages).toEqual([{ type: 'tick' }]);
        vi.advanceTimersByTime(20);
        expect(postedMessages).toHaveLength(3); // 10, 20, 30 ms → 3 ticks
    });

    it('defaults to a 10 ms interval when interval is not positive', async () => {
        await loadWorker();
        // interval <= 0 falls back to the 10 ms floor.
        self.onmessage?.({ data: { type: 'start', interval: 0 } } as MessageEvent);
        vi.advanceTimersByTime(10);
        expect(postedMessages).toHaveLength(1);

        self.onmessage?.({ data: { type: 'start', interval: -5 } } as MessageEvent);
        vi.advanceTimersByTime(10);
        // The previous interval was cleared and a new 10ms one started.
        expect(postedMessages.length).toBeGreaterThanOrEqual(2);
    });

    it('clears the previous interval and restarts when start arrives twice', async () => {
        await loadWorker();
        self.onmessage?.({ data: { type: 'start', interval: 10 } } as MessageEvent);
        vi.advanceTimersByTime(5); // before first tick

        self.onmessage?.({ data: { type: 'start', interval: 20 } } as MessageEvent);
        vi.advanceTimersByTime(10); // old 10ms cleared; new 20ms not elapsed
        expect(postedMessages).toHaveLength(0);

        vi.advanceTimersByTime(10); // 20ms reached → one tick
        expect(postedMessages).toHaveLength(1);
    });

    it('stops posting ticks after a stop message', async () => {
        await loadWorker();
        self.onmessage?.({ data: { type: 'start', interval: 10 } } as MessageEvent);
        vi.advanceTimersByTime(10);
        expect(postedMessages).toHaveLength(1);

        self.onmessage?.({ data: { type: 'stop' } } as MessageEvent);
        vi.advanceTimersByTime(50);
        expect(postedMessages).toHaveLength(1); // frozen after stop
    });

    it('does not crash and posts nothing when stop arrives before any start', async () => {
        await loadWorker();
        self.onmessage?.({ data: { type: 'stop' } } as MessageEvent);
        vi.advanceTimersByTime(50);
        expect(postedMessages).toHaveLength(0);
    });
});
