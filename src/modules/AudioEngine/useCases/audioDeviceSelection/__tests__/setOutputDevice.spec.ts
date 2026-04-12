import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setOutputDevice } from '../setOutputDevice';

const mocks = vi.hoisted(() => ({
    logger: { warn: vi.fn() },
    audioDeviceStoreValue: { value: { selectedOutputId: null } },
    audioDeviceStoreSet: vi.fn(),
    setSinkId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
}));

vi.mock('#/modules/AudioEngine/repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: {
            setSinkId: mocks.setSinkId,
        }
    }
}));

vi.mock('../helpers', () => ({
    audioDeviceStore: {
        get value() { return mocks.audioDeviceStoreValue.value; },
        set: mocks.audioDeviceStoreSet,
    }
}));

describe('setOutputDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.audioDeviceStoreValue.value = { selectedOutputId: 'old' } as any;
    });

    it('calls setSinkId on audio context and updates store', async () => {
        await setOutputDevice('new-out');

        expect(mocks.setSinkId).toHaveBeenCalledWith('new-out');
        expect(mocks.audioDeviceStoreSet).toHaveBeenCalledWith({
            selectedOutputId: 'new-out',
        });
    });

    it('logs warning if setSinkId fails but still updates store', async () => {
        mocks.setSinkId.mockRejectedValue(new Error('Hardware error'));

        await setOutputDevice('fail-out');

        expect(mocks.logger.warn).toHaveBeenCalled();
        expect(mocks.audioDeviceStoreSet).toHaveBeenCalledWith({
            selectedOutputId: 'fail-out',
        });
    });
});
