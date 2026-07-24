import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getAudioDevices } from '../getAudioDevices';

const mocks = vi.hoisted(() => ({
    logger: { warn: vi.fn() },
    enumerateDevices: vi.fn(),
    requestMicPermission: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
}));

vi.mock('../../../repositories/audioRecorder/requestMicPermission', () => ({
    requestMicPermission: mocks.requestMicPermission,
}));

describe('getAudioDevices', () => {
    beforeEach(() => {
        // resetAllMocks, not clearAllMocks: the redaction test queues two
        // `mockResolvedValueOnce` enumerations, and an unconsumed one would leak
        // into the next test. Every test sets its own implementation.
        vi.resetAllMocks();
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

    // Browsers redact every device label until the page has held a media
    // permission once. The eager first-gesture mic prompt used to supply that
    // permission incidentally; with it removed (audit RT-8) this path is what
    // keeps the device picker from showing "Device 1a2b3c4d" for every input.
    it('acquires permission and re-enumerates when every label is redacted', async () => {
        mocks.enumerateDevices
            .mockResolvedValueOnce([
                { deviceId: 'in1', kind: 'audioinput', label: '' },
                { deviceId: 'out1', kind: 'audiooutput', label: '' },
            ])
            .mockResolvedValueOnce([
                { deviceId: 'in1', kind: 'audioinput', label: 'Scarlett 2i2' },
                { deviceId: 'out1', kind: 'audiooutput', label: 'Studio Monitors' },
            ]);
        mocks.requestMicPermission.mockResolvedValue(true);

        const devices = await getAudioDevices();

        expect(mocks.requestMicPermission).toHaveBeenCalledTimes(1);
        expect(mocks.enumerateDevices).toHaveBeenCalledTimes(2);
        expect(devices.map((device) => device.label)).toEqual(['Scarlett 2i2', 'Studio Monitors']);
    });

    it('does not prompt when labels are already readable', async () => {
        mocks.enumerateDevices.mockResolvedValue([
            { deviceId: 'in1', kind: 'audioinput', label: 'Mic 1' },
            { deviceId: 'out1', kind: 'audiooutput', label: 'Speakers' },
        ]);

        const devices = await getAudioDevices();

        expect(mocks.requestMicPermission).not.toHaveBeenCalled();
        expect(mocks.enumerateDevices).toHaveBeenCalledTimes(1);
        expect(devices.map((device) => device.label)).toEqual(['Mic 1', 'Speakers']);
    });

    it('does not prompt when only some labels are missing', async () => {
        mocks.enumerateDevices.mockResolvedValue([
            { deviceId: 'in1', kind: 'audioinput', label: 'Mic 1' },
            { deviceId: 'quiet', kind: 'audioinput', label: '' },
        ]);

        const devices = await getAudioDevices();

        // A partially-labelled list means permission is already held; the blank
        // entry is the device's own doing, and re-prompting would not fix it.
        expect(mocks.requestMicPermission).not.toHaveBeenCalled();
        expect(devices.map((device) => device.label)).toEqual(['Mic 1', 'Device quiet']);
    });

    it('falls back to placeholder labels when permission is refused', async () => {
        mocks.enumerateDevices.mockResolvedValue([{ deviceId: 'in1abc234', kind: 'audioinput', label: '' }]);
        mocks.requestMicPermission.mockResolvedValue(false);

        const devices = await getAudioDevices();

        // Denied permission must not re-enumerate or throw — the picker still
        // renders, just without real names.
        expect(mocks.enumerateDevices).toHaveBeenCalledTimes(1);
        expect(devices).toEqual([{ id: 'in1abc234', label: 'Device in1abc23', kind: 'audioinput' }]);
    });

    it('does not prompt when no audio devices are present at all', async () => {
        mocks.enumerateDevices.mockResolvedValue([{ deviceId: 'vid1', kind: 'videoinput', label: '' }]);

        const devices = await getAudioDevices();

        expect(mocks.requestMicPermission).not.toHaveBeenCalled();
        expect(devices).toEqual([]);
    });
});
