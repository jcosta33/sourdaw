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

function segment(startFrame: number, startValue: number): OfflineAutomationSegment {
    return { startFrame, endFrame: startFrame, startValue, endValue: startValue };
}

describe('convertRecordedAutomationSegments', () => {
    it('emits one step per segment whose value has moved past the slew epsilon', () => {
        const writes = convertRecordedAutomationSegments({
            segments: [segment(0, 0.5), segment(441, 0.50002), segment(882, 0.7)],
            sampleRate: SAMPLE_RATE,
        });

        expect(writes).toEqual([
            { shape: 'step', value: 0.5, time: 0 },
            { shape: 'step', value: 0.7, time: 882 / SAMPLE_RATE },
        ]);
    });

    it('lands a drift that never moves an epsilon in one tick once it has moved one in total', () => {
        // Six steps of two fifths of an epsilon: no neighbouring pair clears
        // the gate, but the third one is 1.2 epsilons above the value that was
        // emitted, which is the value the engine is actually holding.
        const drift = AUTOMATION_SLEW_EPSILON * 0.4;
        const writes = convertRecordedAutomationSegments({
            segments: [0, 1, 2, 3, 4, 5].map((step) => segment(step * 441, 0.2 + step * drift)),
            sampleRate: SAMPLE_RATE,
        });

        expect(writes.map((write) => write.time)).toEqual([0, (3 * 441) / SAMPLE_RATE]);
    });

    it('refuses a sample rate that cannot place a stamp', () => {
        expect(convertRecordedAutomationSegments({ segments: [segment(0, 0.5)], sampleRate: 0 })).toEqual([]);
    });
});
