import { describe, it, expect, beforeEach, vi } from 'vitest';

import { scheduleFaustNote } from '../faustInstrumentScheduler/scheduleFaustNote';
import { startFaustNote } from '../faustInstrumentScheduler/startFaustNote';

const mocks = vi.hoisted(() => ({
    scheduleDeviceKeyOn: vi.fn(),
    scheduleDeviceKeyOff: vi.fn(),
    getCurrentTime: vi.fn(() => 200),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    scheduleDeviceKeyOn: mocks.scheduleDeviceKeyOn,
    scheduleDeviceKeyOff: mocks.scheduleDeviceKeyOff,
    getCurrentTime: mocks.getCurrentTime,
}));

describe('scheduleFaustNote', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('schedules keyOn and keyOff scaling velocity by clipGain', () => {
        scheduleFaustNote('tr', 'dev', 60, 10, 0.5, 100, 0.5);
        expect(mocks.scheduleDeviceKeyOn).toHaveBeenCalledTimes(1);
        expect(mocks.scheduleDeviceKeyOff).toHaveBeenCalledTimes(1);
        expect(mocks.scheduleDeviceKeyOn).toHaveBeenCalledWith('tr', 'dev', 60, 50, 10);
        expect(mocks.scheduleDeviceKeyOff).toHaveBeenCalledWith('tr', 'dev', 60, 0, 10.5);
    });

    it('clamps scaled velocity into [0, 127]', () => {
        scheduleFaustNote('tr', 'dev', 60, 0, 1, 127, 5);
        expect(mocks.scheduleDeviceKeyOn).toHaveBeenCalledWith('tr', 'dev', 60, 127, 0);
    });
});

describe('startFaustNote', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('stop callback schedules keyOff at getCurrentTime', () => {
        const stop = startFaustNote('tr', 'dev', 60, 100, 0);
        expect(mocks.scheduleDeviceKeyOn).toHaveBeenCalledWith('tr', 'dev', 60, 100, 0);
        stop();
        expect(mocks.scheduleDeviceKeyOff).toHaveBeenCalledWith('tr', 'dev', 60, 0, 200);
    });
});
