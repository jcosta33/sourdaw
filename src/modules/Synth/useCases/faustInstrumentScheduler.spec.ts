import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { scheduleFaustNote, startFaustNote } from './faustInstrumentScheduler';

describe('scheduleFaustNote', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('schedules freq, gain, and gate via scheduleDeviceParam', () => {
        const scheduleDeviceParam = vi.fn();
        injectDependencies(scheduleFaustNote, {
            scheduleDeviceParam,
        });
        scheduleFaustNote('tr', 'dev', 60, 10, 0.5, 100, 1);
        expect(scheduleDeviceParam).toHaveBeenCalledTimes(4);
        expect(scheduleDeviceParam).toHaveBeenNthCalledWith(1, 'tr', 'dev', 'freq', expect.any(Number), 10);
        expect(scheduleDeviceParam).toHaveBeenNthCalledWith(2, 'tr', 'dev', 'gain', expect.any(Number), 10);
        expect(scheduleDeviceParam).toHaveBeenNthCalledWith(3, 'tr', 'dev', 'gate', 1, 10);
        expect(scheduleDeviceParam).toHaveBeenNthCalledWith(4, 'tr', 'dev', 'gate', 0, 10.5);
    });
});

describe('startFaustNote', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('stop callback schedules gate off at getCurrentTime', () => {
        const scheduleDeviceParam = vi.fn();
        const getCurrentTime = vi.fn(() => 200);
        injectDependencies(startFaustNote, {
            scheduleDeviceParam,
            getCurrentTime,
        });
        const stop = startFaustNote('tr', 'dev', 60, 100, 0);
        stop();
        expect(scheduleDeviceParam).toHaveBeenCalledWith('tr', 'dev', 'gate', 0, 200);
    });
});
