import { describe, expect, it } from 'vitest';

import {
    asAudioNode,
    asBaseAudioContext,
    createMockAudioContext,
} from '../../../../../../helpers/__tests__/audioContext.mock';
import { KIT_808_DEF } from '../getDrumKitDefByIndex';
import { scheduleDrumKitNote } from '../scheduleDrumKitNote';

/**
 * The real 808 voices, unmocked: the level a hit reaches is the loudest value
 * any of its gain stages is scheduled to, which every voice derives from the
 * velocity it receives.
 */
function scheduledPeak(midiNote: number, kitGain: number): number {
    const ctx = createMockAudioContext();
    scheduleDrumKitNote(
        asBaseAudioContext(ctx),
        asAudioNode(ctx.destination),
        KIT_808_DEF,
        midiNote,
        0,
        100,
        1,
        kitGain
    );
    let peak = 0;
    for (const result of ctx.createGain.mock.results) {
        const param = result.value.gain;
        const scheduled = [
            ...param.setValueAtTime.mock.calls,
            ...param.linearRampToValueAtTime.mock.calls,
            ...param.exponentialRampToValueAtTime.mock.calls,
        ];
        for (const [value] of scheduled) {
            peak = Math.max(peak, Number(value));
        }
    }
    return peak;
}

describe('the drum kit gain levels every 808 voice', () => {
    it.each(KIT_808_DEF.voices.map((voice) => [voice.name, voice.midiNote] as const))(
        '%s (note %i) peaks at the kit gain times its unity level',
        (_name, midiNote) => {
            const unity = scheduledPeak(midiNote, 1);
            expect(unity).toBeGreaterThan(0.001);
            expect(scheduledPeak(midiNote, 0.4) / unity).toBeCloseTo(0.4, 9);
            expect(scheduledPeak(midiNote, 0.8) / unity).toBeCloseTo(0.8, 9);
        }
    );
});
