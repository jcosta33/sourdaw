import { afterEach, describe, expect, it, vi } from 'vitest';

type ObserverModule = typeof import('../observeMainThreadLongTasks');
type LatchModule = typeof import('../../../services/mainThreadLongTaskLatch');

type ObserverCallback = (entries: { getEntries: () => object[] }) => void;

/**
 * Stand-in for the platform class. The observer counts what the callback is
 * handed, so the double has to hand it something.
 */
class FakeLongTaskObserver {
    public static supportedEntryTypes: readonly string[] = ['longtask'];
    public static registrationThrows = false;
    public static latest: FakeLongTaskObserver | null = null;

    public observedTypes: string[] = [];
    public disconnected = false;

    private readonly callback: ObserverCallback;

    public constructor(callback: ObserverCallback) {
        if (FakeLongTaskObserver.registrationThrows) {
            throw new Error('longtask observation refused');
        }
        this.callback = callback;
        FakeLongTaskObserver.latest = this;
    }

    public observe(options: { type: string }): void {
        this.observedTypes.push(options.type);
    }

    public disconnect(): void {
        this.disconnected = true;
    }

    public emitEntries(count: number): void {
        this.callback({ getEntries: () => Array.from({ length: count }, () => ({})) });
    }
}

/** Fresh module state per case — the latch's count and coverage flag are module-level. */
async function loadObserver(): Promise<{ observer: ObserverModule; latch: LatchModule }> {
    vi.resetModules();
    const [observer, latch] = await Promise.all([
        import('../observeMainThreadLongTasks'),
        import('../../../services/mainThreadLongTaskLatch'),
    ]);

    return { observer, latch };
}

function installObserverDouble(): void {
    FakeLongTaskObserver.supportedEntryTypes = ['longtask'];
    FakeLongTaskObserver.registrationThrows = false;
    FakeLongTaskObserver.latest = null;
    vi.stubGlobal('PerformanceObserver', FakeLongTaskObserver);
}

describe('startMainThreadLongTaskObserver', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        FakeLongTaskObserver.supportedEntryTypes = ['longtask'];
        FakeLongTaskObserver.registrationThrows = false;
        FakeLongTaskObserver.latest = null;
    });

    it('leaves coverage closed when the runtime does not list the longtask entry type', async () => {
        installObserverDouble();
        FakeLongTaskObserver.supportedEntryTypes = ['measure', 'paint'];
        const { observer, latch } = await loadObserver();

        observer.startMainThreadLongTaskObserver();

        expect(latch.readMainThreadLongTasks()).toBe(latch.LONG_TASK_OBSERVATION_UNSUPPORTED);
        expect(latch.readMainThreadLongTasks()).not.toBe(0);
        expect(FakeLongTaskObserver.latest).toBeNull();
    });

    it('leaves coverage closed when there is no PerformanceObserver at all', async () => {
        vi.stubGlobal('PerformanceObserver', undefined);
        const { observer, latch } = await loadObserver();

        observer.startMainThreadLongTaskObserver();

        expect(latch.readMainThreadLongTasks()).toBe(latch.LONG_TASK_OBSERVATION_UNSUPPORTED);
        expect(latch.readMainThreadLongTasks()).not.toBe(0);
    });

    it('leaves coverage closed when registration is refused by a throw', async () => {
        installObserverDouble();
        FakeLongTaskObserver.registrationThrows = true;
        const { observer, latch } = await loadObserver();

        const stop = observer.startMainThreadLongTaskObserver();

        expect(latch.readMainThreadLongTasks()).toBe(latch.LONG_TASK_OBSERVATION_UNSUPPORTED);
        expect(latch.readMainThreadLongTasks()).not.toBe(0);
        expect(() => {
            stop();
        }).not.toThrow();
    });

    it('registers for the longtask entry type and counts the entries it is handed', async () => {
        installObserverDouble();
        const { observer, latch } = await loadObserver();

        const stop = observer.startMainThreadLongTaskObserver();

        expect(latch.readMainThreadLongTasks()).toBe(0);
        expect(FakeLongTaskObserver.latest?.observedTypes).toEqual(['longtask']);

        FakeLongTaskObserver.latest?.emitEntries(2);
        FakeLongTaskObserver.latest?.emitEntries(3);

        expect(latch.readMainThreadLongTasks()).toBe(5);

        stop();

        expect(FakeLongTaskObserver.latest?.disconnected).toBe(true);
    });

    it('stops claiming a figure once the observer is disconnected', async () => {
        installObserverDouble();
        const { observer, latch } = await loadObserver();

        const stop = observer.startMainThreadLongTaskObserver();
        FakeLongTaskObserver.latest?.emitEntries(4);
        expect(latch.readMainThreadLongTasks()).toBe(4);

        stop();

        expect(latch.readMainThreadLongTasks()).toBe(latch.LONG_TASK_OBSERVATION_UNSUPPORTED);
        expect(latch.readMainThreadLongTasks()).not.toBe(0);
    });
});
