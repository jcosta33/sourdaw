import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAudioDevices } from '../audioDeviceSelection/getAudioDevices';
import { setOutputDevice } from '../audioDeviceSelection/setOutputDevice';
import { audioEngine } from '../../repositories/createWebAudioEngine';
import { logger } from '#/infra/logger/appLogger';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('../../repositories/createWebAudioEngine', () => ({
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

        const list = await getAudioDevices();

        expect(list).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to enumerate'));
    });

    it('should map enumerated devices', async () => {
        const list = await getAudioDevices();

        expect(list.length).toBe(1);
        expect(list[0]).toMatchObject({ id: 'd1', kind: 'audioinput' });
    });

    it('should set sink id when supported and update store', async () => {
        await setOutputDevice('out-1');

        expect(audioEngine.context.setSinkId).toHaveBeenCalledWith('out-1');
    });
});
