import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    crumbsStore: { subscribe: vi.fn(() => () => {}) },
    commitCrumbsDeviceState: vi.fn(),
}));

vi.mock('../../stores/crumbsStore', () => ({
    crumbsStore: mocks.crumbsStore,
}));

vi.mock('../commitCrumbsDeviceState', () => ({
    commitCrumbsDeviceState: mocks.commitCrumbsDeviceState,
}));

import { initCrumbsDeviceStatePersistence } from '../initCrumbsDeviceStatePersistence';

function makeState(mode = 'sampler', filePath?: string, sampleId?: string) {
    return { mode, activeSample: filePath || sampleId ? { filePath, sampleId } : null };
}

function captureSubscriber() {
    return () => {
        const calls = mocks.crumbsStore.subscribe.mock.calls as unknown as Array<
            [(instances: Record<string, unknown> | null) => void]
        >;
        const fn = calls.at(-1)?.[0];
        if (!fn) {
            throw new Error('no subscriber registered');
        }
        return fn;
    };
}

describe('initCrumbsDeviceStatePersistence', () => {
    it('subscribes to crumbsStore and returns an unsubscribe function', () => {
        const unsub = initCrumbsDeviceStatePersistence();

        expect(mocks.crumbsStore.subscribe).toHaveBeenCalledTimes(1);
        expect(typeof unsub).toBe('function');
    });

    it('commits when a device playback state changes (mode or sample)', () => {
        const getSubscriber = captureSubscriber();
        vi.clearAllMocks();
        initCrumbsDeviceStatePersistence();
        const notify = getSubscriber();

        notify({ 'dev-1': makeState('sampler', 'a.wav', 's1') });
        notify({ 'dev-1': makeState('slicer', 'a.wav', 's1') });

        expect(mocks.commitCrumbsDeviceState).toHaveBeenCalledTimes(1);
        expect(mocks.commitCrumbsDeviceState).toHaveBeenCalledWith('dev-1');
    });

    it('does not commit on first sight (records without committing)', () => {
        const getSubscriber = captureSubscriber();
        vi.clearAllMocks();
        initCrumbsDeviceStatePersistence();
        const notify = getSubscriber();

        notify({ 'dev-1': makeState('sampler', 'a.wav', 's1') });

        expect(mocks.commitCrumbsDeviceState).not.toHaveBeenCalled();
    });

    it('does not commit when playback key is unchanged (metering/frame writes ignored)', () => {
        const getSubscriber = captureSubscriber();
        vi.clearAllMocks();
        initCrumbsDeviceStatePersistence();
        const notify = getSubscriber();

        notify({ 'dev-1': makeState('sampler', 'a.wav', 's1') });
        vi.clearAllMocks();
        notify({ 'dev-1': makeState('sampler', 'a.wav', 's1') });

        expect(mocks.commitCrumbsDeviceState).not.toHaveBeenCalled();
    });

    it('detects sample change as a playback key change', () => {
        const getSubscriber = captureSubscriber();
        vi.clearAllMocks();
        initCrumbsDeviceStatePersistence();
        const notify = getSubscriber();

        notify({ 'dev-1': makeState('sampler', 'a.wav', 's1') });
        vi.clearAllMocks();
        notify({ 'dev-1': makeState('sampler', 'b.wav', 's2') });

        expect(mocks.commitCrumbsDeviceState).toHaveBeenCalledWith('dev-1');
    });

    it('clears committed map when instances become null', () => {
        const getSubscriber = captureSubscriber();
        vi.clearAllMocks();
        initCrumbsDeviceStatePersistence();
        const notify = getSubscriber();

        notify({ 'dev-1': makeState('sampler', 'a.wav', 's1') });
        notify(null);
        vi.clearAllMocks();
        // After null, dev-1 is first-sight again.
        notify({ 'dev-1': makeState('sampler', 'a.wav', 's1') });

        expect(mocks.commitCrumbsDeviceState).not.toHaveBeenCalled();
    });

    it('drops devices that are removed from instances (stale id reuse = first sight)', () => {
        const getSubscriber = captureSubscriber();
        vi.clearAllMocks();
        initCrumbsDeviceStatePersistence();
        const notify = getSubscriber();

        notify({ 'dev-1': makeState('sampler', 'a.wav', 's1') });
        notify({ 'dev-2': makeState('sampler', 'b.wav', 's2') });
        vi.clearAllMocks();
        // dev-1 removed, dev-2 unchanged.
        notify({ 'dev-2': makeState('sampler', 'b.wav', 's2') });

        // dev-2 unchanged → no commit. dev-1 was removed.
        expect(mocks.commitCrumbsDeviceState).not.toHaveBeenCalled();

        // Re-add dev-1 with same state → first sight (no commit).
        notify({ 'dev-1': makeState('sampler', 'a.wav', 's1') });
        expect(mocks.commitCrumbsDeviceState).not.toHaveBeenCalled();
    });
});
