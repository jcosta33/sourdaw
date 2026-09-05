import { beforeEach, describe, expect, it, vi } from 'vitest';

import { audioDeviceStore } from '../helpers';
import { setInputDevice } from '../setInputDevice';
import { setOutputDevice } from '../setOutputDevice';

type SinkIdSetter = (deviceId: string) => Promise<void>;

type FakeAudioContext = {
    setSinkId: SinkIdSetter | string | undefined;
};

function createDeferred(): {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
} {
    let resolvePromise: () => void = () => {};
    let rejectPromise: (error: Error) => void = () => {};
    const promise = new Promise<void>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });

    return { promise, resolve: resolvePromise, reject: rejectPromise };
}

const mocks = vi.hoisted(() => ({
    logger: { warn: vi.fn() },
    notifyUser: vi.fn(),
    context: { setSinkId: undefined as SinkIdSetter | string | undefined } satisfies FakeAudioContext,
    setSinkId: vi.fn<SinkIdSetter>(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
}));

vi.mock('#/modules/AudioEngine/repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: mocks.context,
    },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('setOutputDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.setSinkId.mockReset();
        mocks.setSinkId.mockResolvedValue(undefined);
        mocks.context.setSinkId = mocks.setSinkId;
        audioDeviceStore.set({ selectedOutputId: 'A', selectedInputId: 'input-A' });
    });

    it('updates the selected output only after the hardware request settles and preserves a concurrent input change', async () => {
        const sinkChange = createDeferred();
        const sinkChangeStarted = createDeferred();
        mocks.setSinkId.mockImplementationOnce(() => {
            sinkChangeStarted.resolve();
            return sinkChange.promise;
        });

        const request = setOutputDevice('B');

        await sinkChangeStarted.promise;
        expect(mocks.setSinkId).toHaveBeenCalledWith('B');
        expect(audioDeviceStore.value).toEqual({ selectedOutputId: 'A', selectedInputId: 'input-A' });

        setInputDevice('input-B');
        sinkChange.resolve();
        await request;

        expect(audioDeviceStore.value).toEqual({ selectedOutputId: 'B', selectedInputId: 'input-B' });
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('retains the applied output and notifies the user when the sink rejects', async () => {
        mocks.setSinkId.mockRejectedValueOnce(new Error('Hardware error'));

        await setOutputDevice('B');

        expect(audioDeviceStore.value).toEqual({ selectedOutputId: 'A', selectedInputId: 'input-A' });
        expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to set output device'));
        expect(mocks.notifyUser).toHaveBeenCalledWith('Unable to set output device.', 'error');
    });

    it('retains the applied output and notifies the user when setSinkId is absent or not callable', async () => {
        mocks.context.setSinkId = undefined;

        await setOutputDevice('B');

        expect(audioDeviceStore.value).toEqual({ selectedOutputId: 'A', selectedInputId: 'input-A' });
        expect(mocks.notifyUser).toHaveBeenCalledWith('Unable to set output device.', 'error');

        mocks.context.setSinkId = 'unavailable';
        await setOutputDevice('C');

        expect(audioDeviceStore.value).toEqual({ selectedOutputId: 'A', selectedInputId: 'input-A' });
        expect(mocks.notifyUser).toHaveBeenCalledTimes(2);
    });

    it('serializes output changes and continues after a rejected request', async () => {
        const changeB = createDeferred();
        const changeC = createDeferred();
        const changeD = createDeferred();
        const changeBStarted = createDeferred();
        const changeCStarted = createDeferred();
        const changeDStarted = createDeferred();
        mocks.setSinkId.mockImplementation((deviceId) => {
            if (deviceId === 'B') {
                changeBStarted.resolve();
                return changeB.promise;
            }
            if (deviceId === 'C') {
                changeCStarted.resolve();
                return changeC.promise;
            }
            changeDStarted.resolve();
            return changeD.promise;
        });

        const requestB = setOutputDevice('B');
        const requestC = setOutputDevice('C');
        const requestD = setOutputDevice('D');

        await changeBStarted.promise;
        expect(mocks.setSinkId).toHaveBeenCalledTimes(1);
        expect(mocks.setSinkId).toHaveBeenLastCalledWith('B');

        changeB.resolve();
        await requestB;
        await changeCStarted.promise;
        expect(audioDeviceStore.value).toEqual({ selectedOutputId: 'B', selectedInputId: 'input-A' });

        changeC.reject(new Error('C unavailable'));
        await requestC;
        await changeDStarted.promise;
        expect(audioDeviceStore.value).toEqual({ selectedOutputId: 'B', selectedInputId: 'input-A' });

        changeD.resolve();
        await requestD;

        expect(mocks.setSinkId).toHaveBeenNthCalledWith(2, 'C');
        expect(mocks.setSinkId).toHaveBeenNthCalledWith(3, 'D');
        expect(audioDeviceStore.value).toEqual({ selectedOutputId: 'D', selectedInputId: 'input-A' });
    });
});
