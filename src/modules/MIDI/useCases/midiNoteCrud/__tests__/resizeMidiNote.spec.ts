import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { resizeMidiNote } from '../resizeMidiNote';

function note(id: string, startBeat: number, duration: number) {
    return {
        id,
        pitch: 60,
        startBeat,
        duration,
        velocity: 100,
    };
}

describe('resizeMidiNote', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                c1: [note('n1', 0, 1)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should update start and duration when provided', () => {
        resizeMidiNote('c1', 'n1', 2, 0.5);
        const node = midiStore.value?.notesByClipId.c1?.[0];
        expect(node?.startBeat).toBe(2);
        expect(node?.duration).toBe(0.5);
    });

    it('should enforce a minimum duration of 0.0625 beats (64th note, matching addMidiNote)', () => {
        resizeMidiNote('c1', 'n1', undefined, 0.01);
        expect(midiStore.value?.notesByClipId.c1?.[0]?.duration).toBe(0.0625);
    });

    describe('recorded expression', () => {
        beforeEach(() => {
            midiStore.set({
                notesByClipId: {
                    c1: [
                        {
                            ...note('n1', 0, 4),
                            pressure: 10,
                            expression: {
                                pressure: [
                                    { offsetBeats: 1, value: 90 },
                                    { offsetBeats: 3, value: 20 },
                                ],
                            },
                        },
                    ],
                },
                ccByClipId: {},
                pitchBendByClipId: {},
            });
        });

        it('drops the points at or beyond a shortened duration', () => {
            resizeMidiNote('c1', 'n1', undefined, 2);

            const resized = midiStore.value?.notesByClipId.c1?.[0];
            expect(resized?.duration).toBe(2);
            expect(resized?.pressure).toBe(10);
            expect(resized?.expression).toEqual({ pressure: [{ offsetBeats: 1, value: 90 }] });
        });

        it('starts a start-trimmed note from the value in effect at its new start', () => {
            resizeMidiNote('c1', 'n1', 2, 2);

            const resized = midiStore.value?.notesByClipId.c1?.[0];
            expect(resized?.startBeat).toBe(2);
            expect(resized?.duration).toBe(2);
            expect(resized?.pressure).toBe(90);
            expect(resized?.expression).toEqual({ pressure: [{ offsetBeats: 1, value: 20 }] });
        });

        it('keeps the curve at its performed beats when the start moves earlier', () => {
            midiStore.set({
                notesByClipId: {
                    c1: [
                        {
                            ...note('n1', 2, 2),
                            pressure: 10,
                            expression: { pressure: [{ offsetBeats: 1, value: 90 }] },
                        },
                    ],
                },
                ccByClipId: {},
                pitchBendByClipId: {},
            });

            resizeMidiNote('c1', 'n1', 1, 3);

            const resized = midiStore.value?.notesByClipId.c1?.[0];
            expect(resized?.pressure).toBe(10);
            expect(resized?.expression).toEqual({ pressure: [{ offsetBeats: 2, value: 90 }] });
        });
    });

    it('should not mutate when the clip or store is missing', () => {
        resizeMidiNote('missing', 'n1', 0, 1);
        midiStore.set(null);
        resizeMidiNote('c1', 'n1', 0, 1);
        expect(midiStore.value).toBeNull();
    });
});
