import { describe, expect, it } from 'vitest';

import {
    asAudioNode,
    asBaseAudioContext,
    createMockAudioContext,
} from '../../../../../../helpers/__tests__/audioContext.mock';
import { KIT_808_DEF } from '../getDrumKitDefByIndex';
import { scheduleDrumKitNote } from '../scheduleDrumKitNote';

/**
 * Every amplitude point of the real 808 voices, including their decay floors,
 * must move together so output trim preserves the whole envelope.
 */
function scheduledAmplitudes(midiNote: number, kitGain: number): number[] {
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
    const amplitudes: number[] = [];
    for (const result of ctx.createGain.mock.results) {
        const param = result.value.gain;
        const scheduled = [
            ...param.setValueAtTime.mock.calls,
            ...param.linearRampToValueAtTime.mock.calls,
            ...param.exponentialRampToValueAtTime.mock.calls,
        ];
        for (const [value] of scheduled) {
            amplitudes.push(Number(value));
        }
    }
    return amplitudes;
}

describe('the drum kit gain levels every 808 voice', () => {
    it.each(KIT_808_DEF.voices.map((voice) => [voice.name, voice.midiNote] as const))(
        '%s (note %i) scales its entire amplitude envelope with the kit level',
        (_name, midiNote) => {
            const unity = scheduledAmplitudes(midiNote, 1);
            expect(Math.max(...unity)).toBeGreaterThan(0.001);
            for (const gain of [0.001, 0.4, 0.8]) {
                const trimmed = scheduledAmplitudes(midiNote, gain);
                expect(trimmed).toHaveLength(unity.length);
                for (let point = 0; point < unity.length; point++) {
                    expect(trimmed[point], `gain ${gain}, envelope point ${point}`).toBeCloseTo(
                        unity[point]! * gain,
                        12
                    );
                }
            }
        }
    );
});
