import { describe, expect, it } from 'vitest';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { type CompiledAutomationEvent, compileAutomationEvents } from '../compileAutomationEvents';

// Audit #4591 — two points on one beat are how this codebase writes a hard
// automation jump: the array-earlier point is the value held approaching the
// jump, the array-later one takes over at and after it
// (`transformAutomationPoints.ts`). The live lookup brackets a beat with the
// last point at or before it and the next point, so a ramp into a jump plays
// the ramp. The offline compiler (bounce, freeze and the native engine's
// segments) must play the same ramp.

function identityProjector(beat: number): number {
    return beat;
}

function point(beat: number, value: number): AutomationPoint {
    return { beat, value, curve: 'linear', tension: 0 };
}

/** Value of a Web Audio event list at `time`: set events hold, linear events ramp from the previous event. */
function valueAt(events: readonly CompiledAutomationEvent[], time: number): number {
    let previous = events[0]!;
    for (const event of events) {
        if (event.timeSeconds > time) {
            if (event.type !== 'linear') {
                return previous.value;
            }
            const span = event.timeSeconds - previous.timeSeconds;
            return previous.value + ((event.value - previous.value) * (time - previous.timeSeconds)) / span;
        }
        previous = event;
    }
    return previous.value;
}

describe('compileAutomationEvents — ramp into a hard jump', () => {
    // Ramp 0 → 1 over beats 0–4, jump to 0.2 at beat 4, hold to beat 8.
    const lane = [point(0, 0), point(4, 1), point(4, 0.2), point(8, 0.2)];
    const events = compileAutomationEvents(lane, 8, [], 0, identityProjector);

    it('plays the ramp approaching the jump', () => {
        expect(valueAt(events, 2)).toBeCloseTo(0.5, 6);
        expect(valueAt(events, 3.99)).toBeCloseTo(0.9975, 3);
    });

    it('takes the jump target at and after the jump', () => {
        expect(valueAt(events, 4)).toBeCloseTo(0.2, 6);
        expect(valueAt(events, 6)).toBeCloseTo(0.2, 6);
    });
});
