import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    hydrate: vi.fn(),
    setBacteriaModAssignmentsWithAudio: vi.fn(),
}));

vi.mock('../hydrateBacteriaModAssignmentsFromProject', () => ({
    hydrateBacteriaModAssignmentsFromProject: mocks.hydrate,
}));

vi.mock('../bacteriaParamBridge/setBacteriaModAssignmentsWithAudio', () => ({
    setBacteriaModAssignmentsWithAudio: mocks.setBacteriaModAssignmentsWithAudio,
}));

import { initBacteriaSubscribers } from '../bacteriaSubscriber';

type LoadedPayload = { deviceId: string; deviceType: string };

function setUp() {
    let loaded: ((payload: LoadedPayload) => void) | undefined;
    const unsubscribe = vi.fn();
    const eventBus = {
        on: vi.fn((_event: 'audioDevice.loaded', handler: typeof loaded) => {
            loaded = handler;
            return unsubscribe;
        }),
    };
    const stop = initBacteriaSubscribers({ eventBus, logger: { info: vi.fn() } });
    return { emit: (payload: LoadedPayload) => loaded?.(payload), stop, unsubscribe };
}

describe('initBacteriaSubscribers', () => {
    it('re-applies the project modulation-routing table once a bacteria device loads', () => {
        mocks.hydrate.mockReturnValue([{ sourceId: 'lfo1', targetParam: 'band0_drive', amount: 0.5, bipolar: true }]);
        const { emit, stop, unsubscribe } = setUp();

        emit({ deviceId: 'bacteria-1', deviceType: 'bacteria' });

        expect(mocks.setBacteriaModAssignmentsWithAudio).toHaveBeenCalledExactlyOnceWith('bacteria-1', [
            { sourceId: 'lfo1', targetParam: 'band0_drive', amount: 0.5, bipolar: true },
        ]);
        stop();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('ignores a device family other than bacteria', () => {
        mocks.hydrate.mockClear();
        mocks.setBacteriaModAssignmentsWithAudio.mockClear();
        const { emit } = setUp();

        emit({ deviceId: 'toaster-1', deviceType: 'toaster' });

        expect(mocks.hydrate).not.toHaveBeenCalled();
        expect(mocks.setBacteriaModAssignmentsWithAudio).not.toHaveBeenCalled();
    });

    it('does nothing for a bacteria device with no persisted deviceState', () => {
        mocks.hydrate.mockClear();
        mocks.setBacteriaModAssignmentsWithAudio.mockClear();
        mocks.hydrate.mockReturnValue(null);
        const { emit } = setUp();

        emit({ deviceId: 'bacteria-2', deviceType: 'bacteria' });

        expect(mocks.setBacteriaModAssignmentsWithAudio).not.toHaveBeenCalled();
    });
});
