/**
 * The device half of the automation projection (#3568): a compiled segment
 * stream becomes the step writes a `write-device-parameter` command carries.
 *
 * What these pin is which segments survive. The compiler emits one segment per
 * slew tick, so an unmoving or barely-moving lane produces a segment every
 * ~10 ms carrying a value the engine already holds; each of those would spend a
 * slot of the effect's shared parameter queue. The epsilon gate is therefore
 * load-bearing rather than cosmetic, and it is measured against the last step
 * actually emitted so a slow drift still lands once it has crossed the
 * threshold in total rather than never landing at all.
 */

import { describe, expect, it } from 'vitest';

import { AUTOMATION_SLEW_EPSILON } from '#/utils/automationSlew';

import { type OfflineAutomationSegment } from '../../../repositories/deviceStrategy/AudioDeviceStrategy';
import { convertRecordedAutomationSegments } from '../convertRecordedAutomationSegments';

const SAMPLE_RATE = 44_100;

/** One slew tick at 44.1 kHz, which is the span the compiler emits a segment over. */
const TICK_FRAMES = 441;

/**
 * A segment that actually spans, opening on one value and closing on another.
 *
 * Endpoints are deliberately distinct. A zero-length segment whose two values
 * agree cannot tell the value and frame the converter is required to read — a
 * segment's opening — from the closing pair it must ignore, so a fixture built
 * from those would pass whichever pair the code happened to take.
 */
function segment(startFrame: number, startValue: number, endValue: number): OfflineAutomationSegment {
    return { startFrame, endFrame: startFrame + TICK_FRAMES, startValue, endValue };
}

/** The stream `compileAutomationSegments` produces: each segment opens where the last one closed. */
function contiguous(values: readonly number[]): OfflineAutomationSegment[] {
    return values.map((value, index) => segment(index * TICK_FRAMES, value, values[index + 1] ?? value));
}

describe('convertRecordedAutomationSegments', () => {
    it('emits one step per segment whose value has moved past the slew epsilon', () => {
        const writes = convertRecordedAutomationSegments({
            segments: contiguous([0.5, 0.50002, 0.7]),
            sampleRate: SAMPLE_RATE,
        });

        expect(writes).toEqual([
            { shape: 'step', value: 0.5, time: 0 },
            { shape: 'step', value: 0.7, time: (2 * TICK_FRAMES) / SAMPLE_RATE },
        ]);
    });

    it('skips a segment that opens within the slew epsilon of the step already emitted', () => {
        // Half an epsilon above what the engine is holding. Stating it would
        // spend a slot of the effect's shared parameter queue on a value the
        // plugin already has.
        const writes = convertRecordedAutomationSegments({
            segments: contiguous([0.5, 0.5 + AUTOMATION_SLEW_EPSILON / 2]),
            sampleRate: SAMPLE_RATE,
        });

        expect(writes).toEqual([{ shape: 'step', value: 0.5, time: 0 }]);
    });

    it('lands a drift that never moves an epsilon in one tick once it has moved one in total', () => {
        // Six steps of two fifths of an epsilon: no neighbouring pair clears
        // the gate, but the third one is 1.2 epsilons above the value that was
        // emitted, which is the value the engine is actually holding.
        const drift = AUTOMATION_SLEW_EPSILON * 0.4;
        const writes = convertRecordedAutomationSegments({
            segments: contiguous([0, 1, 2, 3, 4, 5].map((step) => 0.2 + step * drift)),
            sampleRate: SAMPLE_RATE,
        });

        expect(writes.map((write) => write.time)).toEqual([0, (3 * TICK_FRAMES) / SAMPLE_RATE]);
    });

    it('refuses a sample rate that cannot place a stamp', () => {
        expect(convertRecordedAutomationSegments({ segments: contiguous([0.5]), sampleRate: 0 })).toEqual([]);
    });
});
