import { describe, expect, it, vi } from 'vitest';

// scheduleFaustNote delegates to scheduleDeviceParam; stub it to capture the
// (trackId, deviceId, paramId, value, time) tuples without standing up the engine.
// vi.hoisted so the mock fn exists before the hoisted vi.mock factory runs.
const { scheduleDeviceParam } = vi.hoisted(() => ({ scheduleDeviceParam: vi.fn() }));
vi.mock('../../deviceControls/scheduleDeviceParam', () => ({ scheduleDeviceParam }));

import { scheduleFaustNote } from '../scheduleFaustNote';

function callsFor(paramId: string): Array<{ value: number; time: number }> {
    return scheduleDeviceParam.mock.calls
        .filter((c) => c[2] === paramId)
        .map((c) => ({ value: c[3] as number, time: c[4] as number }));
}

describe('scheduleFaustNote', () => {
    it('writes freq/gain/gate-on/gate-off derived from pitch, velocity and duration', () => {
        scheduleDeviceParam.mockClear();
        const pitch = 69; // A4 → 440 Hz
        const velocity = 127; // max → gain 1.0 (clipGain default)
        const startTime = 1.0;
        const duration = 0.5;

        scheduleFaustNote('t1', 'd1', pitch, startTime, duration, velocity);

        // MIDI→Hz: 440 * 2^((pitch-69)/12)
        const freq = callsFor('freq')[0]!;
        expect(freq.value).toBeCloseTo(440 * 2 ** ((69 - 69) / 12));
        expect(freq.time).toBe(startTime);

        const gain = callsFor('gain')[0]!;
        expect(gain.value).toBeCloseTo((127 / 127) * 1.0);
        expect(gain.time).toBe(startTime);

        // gate on at startTime == 1, gate off at startTime + duration
        const gates = callsFor('gate');
        expect(gates).toHaveLength(2);
        expect(gates[0]!.value).toBe(1);
        expect(gates[0]!.time).toBe(startTime);
        expect(gates[1]!.value).toBe(0);
        expect(gates[1]!.time).toBeCloseTo(startTime + duration);

        // every call targets the right track/device
        for (const c of scheduleDeviceParam.mock.calls) {
            expect(c[0]).toBe('t1');
            expect(c[1]).toBe('d1');
        }
    });

    it('applies a non-default clip gain and pitch transpose to the scheduled values', () => {
        scheduleDeviceParam.mockClear();
        const pitch = 81; // A5 → 880 Hz
        const velocity = 64;
        const clipGain = 0.5;

        scheduleFaustNote('t2', 'd2', pitch, 2.0, 0.25, velocity, clipGain);

        expect(callsFor('freq')[0]!.value).toBeCloseTo(440 * 2 ** ((81 - 69) / 12));
        expect(callsFor('gain')[0]!.value).toBeCloseTo((64 / 127) * 0.5);
        // gate off at 2.25
        expect(callsFor('gate')[1]!.time).toBeCloseTo(2.25);
    });
});
