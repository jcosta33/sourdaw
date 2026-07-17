import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getAudioDevices } from '../getAudioDevices';

const mocks = vi.hoisted(() => ({
    logger: { warn: vi.fn() },
    enumerateDevices: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
}));

describe('getAudioDevices', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Mock navigator.mediaDevices
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                mediaDevices: {
                    enumerateDevices: mocks.enumerateDevices,
                },
            },
            configurable: true,
        });
    });

    it('returns filtered and mapped audio devices', async () => {
        mocks.enumerateDevices.mockResolvedValue([
            { deviceId: 'in1', kind: 'audioinput', label: 'Mic 1' },
            { deviceId: 'out1', kind: 'audiooutput', label: 'Speakers' },
            { deviceId: 'vid1', kind: 'videoinput', label: 'Camera' },
            { deviceId: 'no-label', kind: 'audioinput', label: '' },
        ]);

        const devices = await getAudioDevices();

        expect(devices).toHaveLength(3);
        expect(devices[0]).toEqual({ id: 'in1', label: 'Mic 1', kind: 'audioinput' });
        expect(devices[1]).toEqual({ id: 'out1', label: 'Speakers', kind: 'audiooutput' });
        expect(devices[2]?.label).toBe('Device no-label');
    });

    it('returns empty array and logs warning on error', async () => {
        mocks.enumerateDevices.mockRejectedValue(new Error('Permission denied'));

        const devices = await getAudioDevices();

        expect(devices).toEqual([]);
        expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Permission denied'));
    });
});
