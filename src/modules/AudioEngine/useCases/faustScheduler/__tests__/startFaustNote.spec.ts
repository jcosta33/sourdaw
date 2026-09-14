import { describe, expect, it, vi } from 'vitest';

// startFaustNote dispatches through the polyphonic voice allocator
// (scheduleDeviceKeyOn/scheduleDeviceKeyOff); stub both, plus the retired
// parameter route to prove it is no longer used, and the clock the release
// closure reads. vi.hoisted so the mock fns exist before the hoisted
// vi.mock factories run.
const { scheduleDeviceKeyOn, scheduleDeviceKeyOff, scheduleDeviceParam, getCurrentTime } = vi.hoisted(() => ({
    scheduleDeviceKeyOn: vi.fn(),
    scheduleDeviceKeyOff: vi.fn(),
    scheduleDeviceParam: vi.fn(),
    getCurrentTime: vi.fn(),
}));
vi.mock('../../deviceControls/scheduleDeviceKeyOn', () => ({ scheduleDeviceKeyOn }));
vi.mock('../../deviceControls/scheduleDeviceKeyOff', () => ({ scheduleDeviceKeyOff }));
vi.mock('../../deviceControls/scheduleDeviceParam', () => ({ scheduleDeviceParam }));
vi.mock('../../scheduling/getCurrentTime', () => ({ getCurrentTime }));

import { startFaustNote } from '../startFaustNote';

describe('startFaustNote', () => {
    it('starts the audition note through keyOn, not parameter writes', () => {
        startFaustNote('t1', 'd1', 69, 100, 12.5);

        expect(scheduleDeviceKeyOn).toHaveBeenCalledTimes(1);
        expect(scheduleDeviceKeyOn).toHaveBeenCalledWith('t1', 'd1', 69, 100, 12.5);
        expect(scheduleDeviceParam).not.toHaveBeenCalled();
    });

    it('the release closure voices keyOff for that pitch at the current time', () => {
        getCurrentTime.mockReturnValue(20.25);
        const release = startFaustNote('t2', 'd2', 72, 90, 10.0);

        release();

        expect(scheduleDeviceKeyOff).toHaveBeenCalledTimes(1);
        expect(scheduleDeviceKeyOff).toHaveBeenCalledWith('t2', 'd2', 72, 0, 20.25);
        expect(scheduleDeviceParam).not.toHaveBeenCalled();
    });

    it('each note releases its own pitch, so held notes survive a release', () => {
        scheduleDeviceKeyOff.mockClear();
        const releaseA = startFaustNote('t3', 'd3', 60, 80, 1.0);
        startFaustNote('t3', 'd3', 64, 80, 1.0);

        releaseA();

        expect(scheduleDeviceKeyOff).toHaveBeenCalledTimes(1);
        expect(scheduleDeviceKeyOff).toHaveBeenCalledWith('t3', 'd3', 60, 0, expect.any(Number));
    });
});
