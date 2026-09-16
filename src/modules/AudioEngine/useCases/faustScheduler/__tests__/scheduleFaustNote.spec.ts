import { describe, expect, it, vi } from 'vitest';

// scheduleFaustNote dispatches through the polyphonic voice allocator
// (scheduleDeviceKeyOn/scheduleDeviceKeyOff); stub both to capture the
// (trackId, deviceId, pitch, velocity, time) tuples, and stub the retired
// parameter route to prove it is no longer used. vi.hoisted so the mock fns
// exist before the hoisted vi.mock factories run.
const { scheduleDeviceKeyOn, scheduleDeviceKeyOff, scheduleDeviceParam } = vi.hoisted(() => ({
    scheduleDeviceKeyOn: vi.fn(),
    scheduleDeviceKeyOff: vi.fn(),
    scheduleDeviceParam: vi.fn(),
}));
vi.mock('../../deviceControls/scheduleDeviceKeyOn', () => ({ scheduleDeviceKeyOn }));
vi.mock('../../deviceControls/scheduleDeviceKeyOff', () => ({ scheduleDeviceKeyOff }));
vi.mock('../../deviceControls/scheduleDeviceParam', () => ({ scheduleDeviceParam }));

import { scheduleFaustNote } from '../scheduleFaustNote';

describe('scheduleFaustNote', () => {
    it('voices the note through keyOn/keyOff, not parameter writes', () => {
        scheduleFaustNote('t1', 'd1', 69, 1.0, 0.5, 127);

        // One voice allocation at the note start, one release at its end.
        // The poly allocator maps pitch to 440*2^((pitch-69)/12) and velocity
        // to velocity/127 itself; writing freq/gain/gate as device parameters
        // reaches no voice and renders silence (#3721).
        expect(scheduleDeviceKeyOn).toHaveBeenCalledTimes(1);
        expect(scheduleDeviceKeyOn).toHaveBeenCalledWith('t1', 'd1', 69, 127, 1.0);
        expect(scheduleDeviceKeyOff).toHaveBeenCalledTimes(1);
        expect(scheduleDeviceKeyOff).toHaveBeenCalledWith('t1', 'd1', 69, 0, 1.5);
        expect(scheduleDeviceParam).not.toHaveBeenCalled();
    });

    it('scales velocity by clip gain (the allocator divides velocity by 127)', () => {
        scheduleFaustNote('t2', 'd2', 81, 2.0, 0.25, 64, 0.5);

        // keyOn(velocity 32) -> voice gain 32/127 = (64/127) * 0.5, the same
        // value the retired parameter route wrote into the gain control.
        expect(scheduleDeviceKeyOn).toHaveBeenCalledWith('t2', 'd2', 81, 32, 2.0);
        expect(scheduleDeviceKeyOff).toHaveBeenCalledWith('t2', 'd2', 81, 0, 2.25);
    });

    it('releases every call against the right track, device and pitch', () => {
        scheduleDeviceKeyOn.mockClear();
        scheduleDeviceKeyOff.mockClear();
        scheduleFaustNote('t3', 'd3', 60, 0.0, 1.0, 100);

        const on = scheduleDeviceKeyOn.mock.calls[0]!;
        const off = scheduleDeviceKeyOff.mock.calls[0]!;
        expect(on.slice(0, 3)).toEqual(['t3', 'd3', 60]);
        expect(off.slice(0, 3)).toEqual(['t3', 'd3', 60]);
        // The release is addressed to the note's own end, so overlapping notes
        // release independently instead of one gate write cutting them all.
        expect(off[4]).toBe(1.0);
    });
});
