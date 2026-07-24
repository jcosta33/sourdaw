import { describe, it, expect } from 'vitest';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { compileAutomationEvents } from '../compileAutomationEvents';

const DEFAULT_TEMPO = 120;
// At 120 bpm, 1 beat = 0.5 seconds.
const NO_CHANGES: { beat: number; tempo: number }[] = [];

function point(beat: number, value: number, curve: AutomationPoint['curve'] = 'linear'): AutomationPoint {
    return { beat, value, curve, tension: 0 };
}

describe('compileAutomationEvents — basic compilation', () => {
    it('returns an empty array for zero points', () => {
        expect(compileAutomationEvents([], 1, DEFAULT_TEMPO, [])).toEqual([]);
    });

    it('returns an empty array for negative duration', () => {
        expect(compileAutomationEvents([point(0, 1)], -1, DEFAULT_TEMPO, [])).toEqual([]);
    });

    it('emits a single set event for a single point', () => {
        const events = compileAutomationEvents([point(0, 0.5)], 1, DEFAULT_TEMPO, []);
        expect(events).toEqual([{ type: 'set', timeSeconds: 0, value: 0.5 }]);
    });

    it('emits the initial value from the first point at time 0', () => {
        const events = compileAutomationEvents([point(0, 0.2), point(4, 0.8)], 2, DEFAULT_TEMPO, []);
        expect(events[0]).toEqual({ type: 'set', timeSeconds: 0, value: 0.2 });
    });
});

describe('compileAutomationEvents — linear curve', () => {
    it('interpolates linearly between two points and ends at the second value', () => {
        // beat 0→2 at 120bpm = 0→1 second.
        const events = compileAutomationEvents([point(0, 0), point(2, 1)], 1, DEFAULT_TEMPO, NO_CHANGES);
        const last = events.at(-1)!;
        expect(last.type).toBe('linear');
        expect(last.timeSeconds).toBeCloseTo(1, 2);
        expect(last.value).toBeCloseTo(1, 3);
    });

    it('produces monotonically increasing values for an ascending ramp', () => {
        const events = compileAutomationEvents([point(0, 0), point(4, 1)], 2, DEFAULT_TEMPO, NO_CHANGES);
        const values = events.map((event) => event.value);
        for (let i = 1; i < values.length; i++) {
            expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]! - 1e-6);
        }
    });
});

describe('compileAutomationEvents — step curve', () => {
    it('holds the first value until the next point, then jumps (step)', () => {
        const events = compileAutomationEvents([point(0, 0.3, 'step'), point(2, 0.9, 'step')], 1, DEFAULT_TEMPO, []);
        // First event: set 0.3. At beat 2 (1s): set 0.9.
        const setEvents = events.filter((event) => event.type === 'set');
        expect(setEvents.some((event) => event.value === 0.3 && event.timeSeconds === 0)).toBe(true);
        expect(setEvents.some((event) => event.value === 0.9 && event.timeSeconds === 1)).toBe(true);
        // No linear interpolation events.
        expect(events.some((event) => event.type === 'linear')).toBe(false);
    });
});

describe('compileAutomationEvents — stairs curve', () => {
    it('produces discrete stair-step set events with exact values', () => {
        const p1 = point(0, 0, 'stairs');
        p1.stairSteps = 4;
        const events = compileAutomationEvents([p1, point(2, 1)], 1, DEFAULT_TEMPO, []);
        const setEvents = events.filter((event) => event.type === 'set');
        // 4 stairs → values at 0.25, 0.5, 0.75 (the initial 0 is a 'set' too).
        const stairValues = setEvents.map((event) => event.value);
        expect(stairValues).toContain(0.25);
        expect(stairValues).toContain(0.5);
        expect(stairValues).toContain(0.75);
        // All non-initial events are 'set' (discrete), not 'linear'.
        expect(events.some((event) => event.type === 'linear')).toBe(false);
    });

    it('clamps stairSteps below 2 up to 2', () => {
        const p1 = point(0, 0, 'stairs');
        p1.stairSteps = 1; // below minimum → clamped to 2
        const events = compileAutomationEvents([p1, point(2, 1)], 1, DEFAULT_TEMPO, []);
        const setEvents = events.filter((event) => event.type === 'set');
        // Initial set + 2 clamped stairs = exactly 3 set events.
        expect(setEvents).toHaveLength(3);
        // Stair values at 0.5 and 1.0.
        expect(setEvents.map((event) => event.value)).toContain(0.5);
    });
});

describe('compileAutomationEvents — exponential curve', () => {
    it('produces a curved ramp below the linear midpoint for positive tension', () => {
        const p1 = point(0, 0, 'exponential');
        p1.tension = 1;
        const events = compileAutomationEvents([p1, point(2, 1)], 1, DEFAULT_TEMPO, []);
        const linearEvents = events.filter((event) => event.type === 'linear');
        // Find the event closest to midpoint time 0.5s.
        const midEvent = linearEvents.reduce((closest, event) =>
            Math.abs(event.timeSeconds - 0.5) < Math.abs(closest.timeSeconds - 0.5) ? event : closest
        );
        // tension=1 → power = 2^(1*3) = 8. At fraction 0.5: 0.5^8 ≈ 0.0039.
        expect(midEvent.value).toBeCloseTo(0.5 ** 8, 3);
        // Ends at the target value.
        expect(linearEvents.at(-1)!.value).toBeCloseTo(1, 3);
    });
});

describe('compileAutomationEvents — s-curve', () => {
    it('produces a sigmoid ramp that equals 0.5 at the midpoint', () => {
        const p1 = point(0, 0, 's-curve');
        p1.tension = 0; // no tension blend → pure smoothstep
        const events = compileAutomationEvents([p1, point(2, 1)], 1, DEFAULT_TEMPO, []);
        const linearEvents = events.filter((event) => event.type === 'linear');
        const midEvent = linearEvents.reduce((closest, event) =>
            Math.abs(event.timeSeconds - 0.5) < Math.abs(closest.timeSeconds - 0.5) ? event : closest
        );
        // smoothstep(0.5) = 0.5*0.5*(3-2*0.5) = 0.5. With tension 0, curved = fraction.
        expect(midEvent.value).toBeCloseTo(0.5, 2);
        expect(linearEvents.at(-1)!.value).toBeCloseTo(1, 3);
    });
});

describe('compileAutomationEvents — smooth curve (Catmull-Rom)', () => {
    it('interpolates using neighboring points and stays within bounds', () => {
        const p0 = point(0, 0, 'smooth');
        const p1 = point(1, 0.3, 'smooth');
        const p2 = point(3, 0.7, 'smooth');
        const p3 = point(4, 1, 'smooth');
        const events = compileAutomationEvents([p0, p1, p2, p3], 2, DEFAULT_TEMPO, []);
        const linearEvents = events.filter((event) => event.type === 'linear');
        // The smooth curve passes through the control points.
        expect(linearEvents.length).toBeGreaterThan(1);
        // End value reaches the last point's value.
        expect(linearEvents.at(-1)!.value).toBeCloseTo(1, 2);
        // All values are finite.
        for (const event of linearEvents) {
            expect(Number.isFinite(event.value)).toBe(true);
        }
    });
});

describe('compileAutomationEvents — bezier curve', () => {
    it('converges to the endpoint value via Newton-Raphson parameter solve', () => {
        const p1 = point(0, 0, 'bezier');
        p1.cp1 = { x: 0.33, y: 0.1 };
        p1.cp2 = { x: 0.66, y: 0.9 };
        const events = compileAutomationEvents([p1, point(2, 1)], 1, DEFAULT_TEMPO, []);
        const linearEvents = events.filter((event) => event.type === 'linear');
        // The bezier ramp ends at the second point's value.
        expect(linearEvents.at(-1)!.value).toBeCloseTo(1, 3);
        // Starts near the first value.
        expect(linearEvents[0]!.value).toBeCloseTo(0, 1);
    });
});

describe('compileAutomationEvents — deduplication', () => {
    it('does not emit consecutive events with identical type, time, and value', () => {
        // A flat segment (0.5 → 0.5) produces a linear ramp of identical values.
        // appendEvent skips any event whose type+time+value matches the previous.
        const events = compileAutomationEvents([point(0, 0.5), point(2, 0.5)], 1, DEFAULT_TEMPO, []);
        // No two consecutive events share all three of type, timeSeconds, value.
        for (let i = 1; i < events.length; i++) {
            const prev = events[i - 1]!;
            const curr = events[i]!;
            const isDuplicate =
                prev.type === curr.type && prev.timeSeconds === curr.timeSeconds && prev.value === curr.value;
            expect(isDuplicate).toBe(false);
        }
    });
});

describe('compileAutomationEvents — point normalization', () => {
    it('deduplicates points at the same beat, keeping the last', () => {
        const events = compileAutomationEvents([point(0, 0.1), point(0, 0.2), point(2, 0.8)], 1, DEFAULT_TEMPO, []);
        // Initial value is from the last point at beat 0 (0.2, not 0.1).
        expect(events[0]!.value).toBeCloseTo(0.2, 3);
    });

    it('sorts unsorted input points by beat', () => {
        const sorted = compileAutomationEvents([point(0, 0), point(2, 1)], 1, DEFAULT_TEMPO, []);
        const unsorted = compileAutomationEvents([point(2, 1), point(0, 0)], 1, DEFAULT_TEMPO, []);
        // Same result regardless of input order.
        expect(sorted[0]).toEqual(unsorted[0]);
        expect(sorted.at(-1)!.value).toBeCloseTo(unsorted.at(-1)!.value, 3);
    });
});

describe('compileAutomationEvents — tempo changes', () => {
    it('respects tempo changes when projecting beats to seconds', () => {
        // At beat 2, tempo doubles from 120 to 240. Beat 0→2 at 120bpm = 1s.
        // Beat 2→4 at 240bpm = 0.5s. So beat 4 = 1.5s total.
        const changes = [{ beat: 2, tempo: 240 }];
        const events = compileAutomationEvents([point(0, 0), point(4, 1)], 2, DEFAULT_TEMPO, changes);
        const last = events.at(-1)!;
        expect(last.timeSeconds).toBeCloseTo(1.5, 2);
    });
});

describe('compileAutomationEvents — region offset', () => {
    it('offsets event times by regionStartSeconds', () => {
        // Full range beat 0→2 = 0→1s. Region starts at 0.5s.
        const events = compileAutomationEvents([point(0, 0), point(2, 1)], 0.5, DEFAULT_TEMPO, [], 0.5);
        // First event time is 0 (relative to region start).
        expect(events[0]!.timeSeconds).toBe(0);
        // No negative times.
        for (const event of events) {
            expect(event.timeSeconds).toBeGreaterThanOrEqual(0);
        }
    });
});

describe('compileAutomationEvents — custom beat projector', () => {
    it('uses the provided projectBeatToSeconds instead of the default', () => {
        // Custom projector: beat → seconds*2 (half-speed).
        const events = compileAutomationEvents([point(0, 0), point(2, 1)], 4, DEFAULT_TEMPO, [], 0, (beat) => beat * 2);
        // Beat 2 projects to 4 seconds.
        expect(events.at(-1)!.timeSeconds).toBeCloseTo(4, 2);
    });
});

describe('compileAutomationEvents — event types', () => {
    it('emits "set" for the initial value and "linear" for interpolated steps', () => {
        const events = compileAutomationEvents([point(0, 0), point(2, 1)], 1, DEFAULT_TEMPO, []);
        expect(events[0]!.type).toBe('set');
        expect(events.some((event) => event.type === 'linear')).toBe(true);
    });

    it('all events have finite timeSeconds and value', () => {
        const events = compileAutomationEvents([point(0, 0), point(4, 1)], 2, DEFAULT_TEMPO, []);
        for (const event of events) {
            expect(Number.isFinite(event.timeSeconds)).toBe(true);
            expect(Number.isFinite(event.value)).toBe(true);
        }
    });
});

describe('compileAutomationEvents — device-param slew (AU-2)', () => {
    const SLEW = { slew: { alpha: 0.4, tickSeconds: 0.01 } };

    it('replicates the live IIR over a stepped device curve and settles on the target', () => {
        // step 0 -> 1 at beat 2 (1s at 120bpm).
        const events = compileAutomationEvents(
            [point(0, 0, 'step'), point(2, 1, 'step')],
            1,
            DEFAULT_TEMPO,
            [],
            0,
            undefined,
            SLEW
        );
        expect(events[0]).toEqual({ type: 'set', timeSeconds: 0, value: 0 });
        const post = events.map((event) => event.value).filter((value) => value > 0);
        // First slewed samples after the step: y=0.4, 0.64, 0.784 (alpha 0.4).
        expect(post[0]).toBeCloseTo(0.4, 10);
        expect(post[1]).toBeCloseTo(0.64, 10);
        expect(post[2]).toBeCloseTo(0.784, 10);
        // Lands exactly on the target so the param holds the right value.
        expect(events.at(-1)!.value).toBe(1);
    });

    it('leaves a single-point lane unslewed (nothing to smooth)', () => {
        const events = compileAutomationEvents([point(0, 0.5)], 1, DEFAULT_TEMPO, [], 0, undefined, SLEW);
        expect(events).toEqual([{ type: 'set', timeSeconds: 0, value: 0.5 }]);
    });
});

describe('compileAutomationEvents — clip active window (AU-12)', () => {
    it('crops emission to the clip span while keeping the export time origin', () => {
        // Linear 0 -> 1 over beats 0..8 (0..4s); clip active only 1..3s.
        const events = compileAutomationEvents([point(0, 0), point(8, 1)], 4, DEFAULT_TEMPO, [], 0, undefined, {
            activeWindowSeconds: { startSeconds: 1, endSeconds: 3 },
        });
        expect(events[0]!.timeSeconds).toBeCloseTo(1, 10);
        expect(events[0]!.value).toBeCloseTo(0.25, 10);
        expect(events.at(-1)!.timeSeconds).toBeCloseTo(3, 10);
        expect(events.at(-1)!.value).toBeCloseTo(0.75, 10);
    });

    it('emits nothing when the clip window is entirely outside the region', () => {
        const events = compileAutomationEvents([point(0, 0), point(8, 1)], 4, DEFAULT_TEMPO, [], 0, undefined, {
            activeWindowSeconds: { startSeconds: 10, endSeconds: 12 },
        });
        expect(events).toEqual([]);
    });
});
