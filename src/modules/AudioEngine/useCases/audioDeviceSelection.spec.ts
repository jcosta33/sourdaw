import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getAudioDevices, setOutputDevice } from './audioDeviceSelection';
import { type Logger } from '#/helpers/Logger/Logger';
import { audioEngine } from '#/modules/AudioEngine/repositories/createWebAudioEngine';

vi.mock('#/modules/AudioEngine/repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: {
            setSinkId: vi.fn().mockResolvedValue(undefined),
        },
    },
}));

describe('audioDeviceSelection injectables', () => {
    beforeEach(() => {
        const enumerateDevices = vi.fn().mockResolvedValue([
            { deviceId: 'd1', kind: 'audioinput', label: 'Mic' },
        ] as MediaDeviceInfo[]);
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: { enumerateDevices },
            configurable: true,
        });
    });

    it('should return empty list and warn when enumeration fails', async () => {
        globalThis.navigator.mediaDevices.enumerateDevices = vi.fn().mockRejectedValue(new Error('no devices'));

        const logger = createMock<Logger>();
        injectDependencies(getAudioDevices, { logger });

        const list = await getAudioDevices();

        expect(list).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to enumerate'));
    });

    it('should map enumerated devices', async () => {
        const logger = createMock<Logger>();
        injectDependencies(getAudioDevices, { logger });

        const list = await getAudioDevices();

        expect(list.length).toBe(1);
        expect(list[0]).toMatchObject({ id: 'd1', kind: 'audioinput' });
    });

    it('should set sink id when supported and update store', async () => {
        const logger = createMock<Logger>();
        injectDependencies(setOutputDevice, { logger });

        await setOutputDevice('out-1');

        expect(audioEngine.context.setSinkId).toHaveBeenCalledWith('out-1');
    });
});
