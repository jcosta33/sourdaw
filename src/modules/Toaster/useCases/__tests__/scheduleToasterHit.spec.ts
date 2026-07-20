import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getToasterDeviceControls } from '#/modules/AudioEngine/useCases';

import { scheduleToasterHit } from '../scheduleToasterHit';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioSampleRate: vi.fn(() => 48_000),
    getToasterDeviceControls: vi.fn(),
}));

describe('scheduleToasterHit', () => {
    const scheduleHit = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getToasterDeviceControls).mockReturnValue({ ready: true, scheduleHit } as never);
    });

    it('converts audio-clock time into the worklet sample frame and preserves locks', () => {
        scheduleToasterHit({
            deviceId: 'toast-1',
            padIndex: 2,
            velocity: 101,
            targetTimeSeconds: 1.25,
            padParams: [{ name: 'tone', value: 0.7 }],
            restoreEngineType: 0,
        });

        expect(scheduleHit).toHaveBeenCalledWith({
            pad: 2,
            velocity: 101,
            sampleFrame: 60_000,
            padParams: [{ name: 'tone', value: 0.7 }],
            restoreEngineType: 0,
        });
    });

    it('does nothing until the target Toaster controls are ready', () => {
        vi.mocked(getToasterDeviceControls).mockReturnValue(undefined);

        scheduleToasterHit({
            deviceId: 'missing',
            padIndex: 0,
            velocity: 100,
            targetTimeSeconds: 0,
        });

        expect(scheduleHit).not.toHaveBeenCalled();
    });
});
