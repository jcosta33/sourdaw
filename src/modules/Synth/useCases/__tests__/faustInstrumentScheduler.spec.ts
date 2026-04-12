import { describe, it, expect, beforeEach, vi } from 'vitest';
import { scheduleFaustNote } from '../faustInstrumentScheduler/scheduleFaustNote';
import { startFaustNote } from '../faustInstrumentScheduler/startFaustNote';

const mocks = vi.hoisted(() => ({
    scheduleDeviceParam: vi.fn(),
    getCurrentTime: vi.fn(() => 200),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    scheduleDeviceParam: mocks.scheduleDeviceParam,
    getCurrentTime: mocks.getCurrentTime,
}));

describe('scheduleFaustNote', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('schedules freq, gain, and gate via scheduleDeviceParam', () => {
        scheduleFaustNote('tr', 'dev', 60, 10, 0.5, 100, 1);
        expect(mocks.scheduleDeviceParam).toHaveBeenCalledTimes(4);
        expect(mocks.scheduleDeviceParam).toHaveBeenNthCalledWith(1, 'tr', 'dev', 'freq', expect.any(Number), 10);
        expect(mocks.scheduleDeviceParam).toHaveBeenNthCalledWith(2, 'tr', 'dev', 'gain', expect.any(Number), 10);
        expect(mocks.scheduleDeviceParam).toHaveBeenNthCalledWith(3, 'tr', 'dev', 'gate', 1, 10);
        expect(mocks.scheduleDeviceParam).toHaveBeenNthCalledWith(4, 'tr', 'dev', 'gate', 0, 10.5);
    });
});

describe('startFaustNote', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('stop callback schedules gate off at getCurrentTime', () => {
        const stop = startFaustNote('tr', 'dev', 60, 100, 0);
        stop();
        expect(mocks.scheduleDeviceParam).toHaveBeenCalledWith('tr', 'dev', 'gate', 0, 200);
    });
});
