import { describe, expect, it } from 'vitest';

import { shouldPlayMidiEvent } from '../shouldPlayMidiEvent';

const CROSS_RUNTIME_CORPUS = [
    { seed: 0, clipId: 'clip-0', eventId: 'event-0', occurrence: 0, probability: 50, expected: false },
    { seed: 1, clipId: 'clip-a', eventId: 'event-alpha', occurrence: 0, probability: 50, expected: true },
    {
        seed: 0xdecafbad,
        clipId: 'clip-1',
        eventId: 'event-alpha',
        occurrence: 0,
        probability: 50,
        expected: true,
    },
    {
        seed: 0xdecafbad,
        clipId: 'clip-1',
        eventId: 'event-beta',
        occurrence: 0,
        probability: 50,
        expected: false,
    },
    {
        seed: 0xffff_ffff,
        clipId: 'loop-🎹',
        eventId: 'note-Ω',
        occurrence: 4_294_967_297,
        probability: 90,
        expected: true,
    },
    {
        seed: 0x12345678,
        clipId: 'clip-shared',
        eventId: 'event-stable',
        occurrence: 42,
        probability: 70,
        expected: false,
    },
] as const;

describe('shouldPlayMidiEvent', () => {
    it('matches the fixed cross-runtime tuple corpus', () => {
        for (const row of CROSS_RUNTIME_CORPUS) {
            expect(
                shouldPlayMidiEvent({
                    projectProbabilitySeed: row.seed,
                    clipId: row.clipId,
                    eventId: row.eventId,
                    absoluteOccurrenceIndex: row.occurrence,
                    probabilityPercent: row.probability,
                })
            ).toBe(row.expected);
        }
    });

    it('makes zero and one hundred percent exact', () => {
        const tuple = {
            projectProbabilitySeed: 0x12345678,
            clipId: 'clip-a',
            eventId: 'event-stable',
            absoluteOccurrenceIndex: 3,
        };

        expect(shouldPlayMidiEvent({ ...tuple, probabilityPercent: 0 })).toBe(false);
        expect(shouldPlayMidiEvent({ ...tuple, probabilityPercent: 100 })).toBe(true);
    });

    it('retains the roll stream for in-place edits and changes it for duplication or moving clips', () => {
        const stableTuple = {
            projectProbabilitySeed: 0x12345678,
            clipId: 'clip-a',
            eventId: 'event-stable',
            absoluteOccurrenceIndex: 3,
            probabilityPercent: 50,
        };

        expect(shouldPlayMidiEvent(stableTuple)).toBe(false);
        expect(shouldPlayMidiEvent({ ...stableTuple })).toBe(false);
        expect(shouldPlayMidiEvent({ ...stableTuple, eventId: 'event-copy' })).toBe(true);
        expect(shouldPlayMidiEvent({ ...stableTuple, clipId: 'clip-0' })).toBe(true);
    });
});
