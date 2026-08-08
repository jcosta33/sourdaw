import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    levainStore: { subscribe: vi.fn(() => () => {}) },
    commitLevainDeviceState: vi.fn(),
}));

vi.mock('../../stores/levainStore', () => ({
    levainStore: mocks.levainStore,
}));

vi.mock('../commitLevainDeviceState', () => ({
    commitLevainDeviceState: mocks.commitLevainDeviceState,
}));

import { initLevainDeviceStatePersistence } from '../initLevainDeviceStatePersistence';

function makePatch(instrumentId: string, currentArticulation: string) {
    return { instrumentId, currentArticulation };
}

function makeState(instrumentId: string, currentArticulation: string) {
    return { patch: makePatch(instrumentId, currentArticulation) };
}

type LevainInstance = Record<string, { patch: { instrumentId: string; currentArticulation: string } }>;

function captureSubscriber() {
    return () => {
        const calls = mocks.levainStore.subscribe.mock.calls as unknown as Array<
            [(instances: LevainInstance | null) => void]
        >;
        const fn = calls.at(-1)?.[0];
        if (!fn) {
            throw new Error('no subscriber');
        }
        return fn;
    };
}

describe('initLevainDeviceStatePersistence', () => {
    it('subscribes and returns unsubscribe', () => {
        const unsub = initLevainDeviceStatePersistence();

        expect(mocks.levainStore.subscribe).toHaveBeenCalledTimes(1);
        expect(typeof unsub).toBe('function');
    });

    it('commits when instrument identity changes (instrumentId or articulation)', () => {
        const getSubscriber = captureSubscriber();
        vi.clearAllMocks();
        initLevainDeviceStatePersistence();
        const notify = getSubscriber();

        notify({ 'dev-1': makeState('violin-1', 'arco') });
        notify({ 'dev-1': makeState('cello', 'arco') });

        expect(mocks.commitLevainDeviceState).toHaveBeenCalledTimes(1);
        expect(mocks.commitLevainDeviceState).toHaveBeenCalledWith('dev-1');
    });

    it('does not commit on first sight', () => {
        const getSubscriber = captureSubscriber();
        vi.clearAllMocks();
        initLevainDeviceStatePersistence();
        const notify = getSubscriber();

        notify({ 'dev-1': makeState('violin-1', 'arco') });

        expect(mocks.commitLevainDeviceState).not.toHaveBeenCalled();
    });

    it('does not commit when identity key unchanged (knob turns ignored)', () => {
        const getSubscriber = captureSubscriber();
        vi.clearAllMocks();
        initLevainDeviceStatePersistence();
        const notify = getSubscriber();

        notify({ 'dev-1': makeState('violin-1', 'arco') });
        vi.clearAllMocks();
        notify({ 'dev-1': makeState('violin-1', 'arco') });

        expect(mocks.commitLevainDeviceState).not.toHaveBeenCalled();
    });

    it('detects articulation change as an identity change', () => {
        const getSubscriber = captureSubscriber();
        vi.clearAllMocks();
        initLevainDeviceStatePersistence();
        const notify = getSubscriber();

        notify({ 'dev-1': makeState('violin-1', 'arco') });
        vi.clearAllMocks();
        notify({ 'dev-1': makeState('violin-1', 'pizzicato') });

        expect(mocks.commitLevainDeviceState).toHaveBeenCalledWith('dev-1');
    });

    it('clears committed map on null instances', () => {
        const getSubscriber = captureSubscriber();
        vi.clearAllMocks();
        initLevainDeviceStatePersistence();
        const notify = getSubscriber();

        notify({ 'dev-1': makeState('violin-1', 'arco') });
        notify(null);
        vi.clearAllMocks();
        notify({ 'dev-1': makeState('violin-1', 'arco') });

        expect(mocks.commitLevainDeviceState).not.toHaveBeenCalled();
    });

    it('drops removed devices (id reuse = first sight)', () => {
        const getSubscriber = captureSubscriber();
        vi.clearAllMocks();
        initLevainDeviceStatePersistence();
        const notify = getSubscriber();

        notify({ 'dev-1': makeState('violin-1', 'arco'), 'dev-2': makeState('cello', 'arco') });
        notify({ 'dev-2': makeState('cello', 'arco') });
        vi.clearAllMocks();
        // dev-1 re-added → first sight, no commit.
        notify({ 'dev-1': makeState('violin-1', 'arco'), 'dev-2': makeState('cello', 'arco') });

        expect(mocks.commitLevainDeviceState).not.toHaveBeenCalled();
    });
});
