import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreStateInput } from '../../../stores/midiStore';

const mocks = vi.hoisted(() => ({
    state: { value: null as MidiStoreStateInput | null },
}));

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value(): MidiStoreStateInput | null {
            return mocks.state.value;
        },
    },
}));

const { prepareMidiClipGlueState } = await import('../prepareMidiClipGlueState');
const { projectChannelBend } = await import('../projectChannelBend');

const sources = [
    { clipId: 'source-a', beatOffset: 0, visibleStartBeat: 0, visibleEndBeat: 4 },
    { clipId: 'source-b', beatOffset: 4, visibleStartBeat: 0, visibleEndBeat: 4 },
] as const;

describe('prepareMidiClipGlueState', () => {
    beforeEach(() => {
        mocks.state.value = {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        };
    });

    it('rejects identity-dependent probabilistic source notes', () => {
        mocks.state.value = {
            notesByClipId: {
                'source-a': [
                    {
                        id: 'probabilistic-note',
                        pitch: 60,
                        startBeat: 1,
                        duration: 1,
                        velocity: 100,
                        probability: 50,
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        expect(prepareMidiClipGlueState({ sources, targetClipId: 'target' })).toBeNull();
        expect(mocks.state.value.notesByClipId['source-a']).toMatchObject([
            { id: 'probabilistic-note', probability: 50 },
        ]);
    });

    it.each([0, 100])('allows identity-independent probability %i', (probability) => {
        mocks.state.value = {
            notesByClipId: {
                'source-a': [
                    {
                        id: `note-${probability}`,
                        pitch: 60,
                        startBeat: 1,
                        duration: 1,
                        velocity: 100,
                        probability,
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        const plan = prepareMidiClipGlueState({ sources, targetClipId: 'target' });

        expect(plan?.next.clips.at(-1)?.data.notes.value).toMatchObject([{ probability }]);
    });

    it('rejects duplicate migration markers before preparing a glue write', () => {
        mocks.state.value = {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
            migratedAbsoluteNoteClipIds: ['unrelated', 'unrelated'],
        };

        expect(prepareMidiClipGlueState({ sources, targetClipId: 'target' })).toBeNull();
        expect(mocks.state.value.migratedAbsoluteNoteClipIds).toEqual(['unrelated', 'unrelated']);
    });

    it('folds a curve point into the scalar and rebases remaining points when the visible window starts after the first point', () => {
        mocks.state.value = {
            notesByClipId: {
                'source-a': [
                    {
                        id: 'curved-note',
                        pitch: 60,
                        startBeat: 0,
                        duration: 2,
                        velocity: 100,
                        expression: {
                            pressure: [
                                { offsetBeats: 0.5, value: 40 },
                                { offsetBeats: 1.5, value: 90 },
                            ],
                        },
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        const glueSources = [
            { clipId: 'source-a', beatOffset: 0, visibleStartBeat: 1, visibleEndBeat: 2 },
            { clipId: 'source-b', beatOffset: 4, visibleStartBeat: 0, visibleEndBeat: 4 },
        ];

        const plan = prepareMidiClipGlueState({ sources: glueSources, targetClipId: 'target' });
        const glued = plan?.next.clips.at(-1)?.data.notes.value.find((note) => note.id === 'curved-note');

        expect(glued).toMatchObject({
            startBeat: 1,
            duration: 1,
            pressure: 40,
            expression: { pressure: [{ offsetBeats: 0.5, value: 90 }] },
        });
    });

    it('orders equal-time notes by UTF-16 code unit of the id and equal-time controller rows by source order', () => {
        mocks.state.value = {
            notesByClipId: {
                'source-a': [
                    { id: 'é-note', pitch: 60, startBeat: 1, duration: 1, velocity: 100 },
                    { id: 'z-note', pitch: 62, startBeat: 1, duration: 1, velocity: 100 },
                ],
            },
            ccByClipId: {
                'source-a': [
                    { id: 'é-cc', controller: 1, value: 32, beat: 1, channel: 0 },
                    { id: 'z-cc', controller: 2, value: 64, beat: 1, channel: 0 },
                ],
            },
            pitchBendByClipId: {
                'source-a': [
                    { id: 'é-bend', value: 128, beat: 1, channel: 0 },
                    { id: 'z-bend', value: 256, beat: 1, channel: 0 },
                ],
            },
        };

        const plan = prepareMidiClipGlueState({ sources, targetClipId: 'target' });
        const target = plan?.next.clips.find((clip) => clip.clipId === 'target');

        expect(target?.data.notes.value.map((note) => note.id)).toEqual(['z-note', 'é-note']);
        expect(target?.data.controlChanges.value.map((controlChange) => controlChange.id)).toEqual(['é-cc', 'z-cc']);
        expect(target?.data.pitchBends.value.map((pitchBend) => pitchBend.id)).toEqual(['é-bend', 'z-bend']);
    });

    it('keeps a same-beat re-pedal in source order whatever the ids sort to', () => {
        mocks.state.value = {
            notesByClipId: {},
            ccByClipId: {
                'source-a': [
                    { id: 'z-release', controller: 64, value: 0, beat: 3, channel: 0 },
                    { id: 'a-press', controller: 64, value: 127, beat: 3, channel: 0 },
                ],
                'source-b': [
                    { id: 'y-release', controller: 64, value: 0, beat: 1, channel: 0 },
                    { id: 'b-press', controller: 64, value: 127, beat: 1, channel: 0 },
                ],
            },
            pitchBendByClipId: {
                'source-a': [
                    { id: 'z-down', value: -4096, beat: 3, channel: 0 },
                    { id: 'a-up', value: 4096, beat: 3, channel: 0 },
                ],
            },
        };

        const plan = prepareMidiClipGlueState({ sources, targetClipId: 'target' });
        const target = plan?.next.clips.find((clip) => clip.clipId === 'target');

        expect(target?.data.controlChanges.value.map(({ id, beat, value }) => [id, beat, value])).toEqual([
            ['z-release', 3, 0],
            ['a-press', 3, 127],
            ['y-release', 5, 0],
            ['b-press', 5, 127],
        ]);
        expect(target?.data.pitchBends.value.map(({ id, value }) => [id, value])).toEqual([
            ['z-down', -4096],
            ['a-up', 4096],
        ]);
    });

    it('carries the pedal held into a source whose visible window starts mid-pedal', () => {
        mocks.state.value = {
            notesByClipId: {},
            ccByClipId: {
                'source-b': [
                    { id: 'hidden-down', controller: 64, value: 127, beat: 1, channel: 0 },
                    { id: 'visible-up', controller: 64, value: 0, beat: 3, channel: 0 },
                ],
            },
            pitchBendByClipId: {},
        };
        const midPedalSources = [
            { clipId: 'source-a', beatOffset: 0, visibleStartBeat: 0, visibleEndBeat: 4 },
            { clipId: 'source-b', beatOffset: 4, visibleStartBeat: 2, visibleEndBeat: 6 },
        ];

        const plan = prepareMidiClipGlueState({ sources: midPedalSources, targetClipId: 'target' });
        const target = plan?.next.clips.find((clip) => clip.clipId === 'target');

        expect(
            target?.data.controlChanges.value.map(({ beat, value, controller, channel }) => ({
                beat,
                value,
                controller,
                channel,
            }))
        ).toEqual([
            { beat: 6, value: 127, controller: 64, channel: 0 },
            { beat: 7, value: 0, controller: 64, channel: 0 },
        ]);
    });

    it.each([
        {
            name: 'the latest hidden beat',
            rows: [
                { id: 'down', controller: 64, value: 127, beat: 0, channel: 0 },
                { id: 'up', controller: 64, value: 0, beat: 1, channel: 0 },
            ],
            carried: ['up', 6, 0],
        },
        {
            name: 'the latest hidden beat when rows are stored out of beat order',
            rows: [
                { id: 'up', controller: 64, value: 0, beat: 1, channel: 0 },
                { id: 'down', controller: 64, value: 127, beat: 0, channel: 0 },
            ],
            carried: ['up', 6, 0],
        },
        {
            name: 'the later source row when hidden rows share a beat',
            rows: [
                { id: 'z-release', controller: 64, value: 0, beat: 1, channel: 0 },
                { id: 'a-press', controller: 64, value: 127, beat: 1, channel: 0 },
            ],
            carried: ['a-press', 6, 127],
        },
    ])('carries the value in force at a source window start from $name', ({ rows, carried }) => {
        mocks.state.value = {
            notesByClipId: {},
            ccByClipId: { 'source-b': rows },
            pitchBendByClipId: {},
        };
        const midPedalSources = [
            { clipId: 'source-a', beatOffset: 0, visibleStartBeat: 0, visibleEndBeat: 4 },
            { clipId: 'source-b', beatOffset: 4, visibleStartBeat: 2, visibleEndBeat: 6 },
        ];

        const plan = prepareMidiClipGlueState({ sources: midPedalSources, targetClipId: 'target' });
        const target = plan?.next.clips.find((clip) => clip.clipId === 'target');

        expect(target?.data.controlChanges.value.map(({ id, beat, value }) => [id, beat, value])).toEqual([carried]);
    });

    it('keeps each source closing-line controller row, ahead of the next source head on the seam', () => {
        mocks.state.value = {
            notesByClipId: {},
            ccByClipId: {
                'source-a': [
                    { id: 'a-down', controller: 64, value: 127, beat: 0, channel: 0 },
                    { id: 'a-lift', controller: 64, value: 0, beat: 4, channel: 0 },
                ],
                'source-b': [
                    { id: 'b-press', controller: 64, value: 127, beat: 0, channel: 0 },
                    { id: 'b-lift', controller: 64, value: 0, beat: 4, channel: 0 },
                ],
            },
            pitchBendByClipId: {},
        };

        const plan = prepareMidiClipGlueState({ sources, targetClipId: 'target' });
        const target = plan?.next.clips.find((clip) => clip.clipId === 'target');

        // The glued clip plays what the two did: source A lifts on its end, source B presses on its
        // head on the same beat and has the last word, and B's own closing lift is the glued clip's.
        expect(target?.data.controlChanges.value.map(({ id, beat, value }) => [id, beat, value])).toEqual([
            ['a-down', 0, 127],
            ['a-lift', 4, 0],
            ['b-press', 4, 127],
            ['b-lift', 8, 0],
        ]);
    });

    it('orders a source closing-line lift ahead of the next source head when the seam rounds an ulp apart', () => {
        // Source A's end is 0.1 + 0.2, an ulp past the 0.3 where source B's head lands: the lift
        // must land on the earlier of the two, or it sorts after B's press and lifts B's pedal.
        const seamSources = [
            { clipId: 'source-a', beatOffset: 0, visibleStartBeat: 0, visibleEndBeat: 0.1 + 0.2 },
            { clipId: 'source-b', beatOffset: 0.3, visibleStartBeat: 0, visibleEndBeat: 1 },
        ];
        expect(seamSources[0]!.visibleEndBeat).toBeGreaterThan(seamSources[1]!.beatOffset);
        mocks.state.value = {
            notesByClipId: {},
            ccByClipId: {
                'source-a': [{ id: 'a-lift', controller: 64, value: 0, beat: 0.1 + 0.2, channel: 0 }],
                'source-b': [{ id: 'b-press', controller: 64, value: 127, beat: 0, channel: 0 }],
            },
            pitchBendByClipId: {},
        };

        const plan = prepareMidiClipGlueState({ sources: seamSources, targetClipId: 'target' });
        const target = plan?.next.clips.find((clip) => clip.clipId === 'target');

        expect(target?.data.controlChanges.value.map(({ id }) => id)).toEqual(['a-lift', 'b-press']);
    });

    it('does not carry a controller value over a row the lane already has at the visible start', () => {
        mocks.state.value = {
            notesByClipId: {},
            ccByClipId: {
                'source-b': [
                    { id: 'hidden-down', controller: 64, value: 127, beat: 1, channel: 0 },
                    { id: 'at-start', controller: 64, value: 40, beat: 2, channel: 0 },
                    { id: 'other-lane-hidden', controller: 1, value: 9, beat: 0, channel: 0 },
                ],
            },
            pitchBendByClipId: {
                'source-b': [
                    { id: 'bend-hidden', value: 2048, beat: 1, channel: 2 },
                    { id: 'bend-late', value: 6144, beat: 5, channel: 2 },
                ],
            },
        };
        const midPedalSources = [
            { clipId: 'source-a', beatOffset: 0, visibleStartBeat: 0, visibleEndBeat: 4 },
            { clipId: 'source-b', beatOffset: 4, visibleStartBeat: 2, visibleEndBeat: 6 },
        ];

        const plan = prepareMidiClipGlueState({ sources: midPedalSources, targetClipId: 'target' });
        const target = plan?.next.clips.find((clip) => clip.clipId === 'target');

        expect(target?.data.controlChanges.value.map(({ id, beat, value }) => [id, beat, value])).toEqual([
            ['other-lane-hidden', 6, 9],
            ['at-start', 6, 40],
        ]);
        expect(target?.data.pitchBends.value.map(({ id, beat, value }) => [id, beat, value])).toEqual([
            ['bend-hidden', 6, 2048],
            ['bend-late', 9, 6144],
        ]);
    });

    describe('the bend range a registered parameter declared', () => {
        type Row = { id: string; beat: number; controller: number; value: number; channel: number };

        function row(id: string, beat: number, controller: number, value: number): Row {
            return { id, beat, controller, value, channel: 0 };
        }

        /** RPN 0 = `semitones`, then the Null RPN a controller sends after a data entry. */
        function nullTerminatedRange(prefix: string, beat: number, semitones: number): Row[] {
            return [
                row(`${prefix}-msb`, beat, 101, 0),
                row(`${prefix}-lsb`, beat + 0.25, 100, 0),
                row(`${prefix}-data-msb`, beat + 0.5, 6, semitones),
                row(`${prefix}-data-lsb`, beat + 0.75, 38, 0),
                row(`${prefix}-null-msb`, beat + 1, 101, 127),
                row(`${prefix}-null-lsb`, beat + 1.25, 100, 127),
            ];
        }

        /** The depth each move of the glued clip's channel bend plays under. */
        function rangesPlayed(plan: ReturnType<typeof prepareMidiClipGlueState>) {
            const target = plan?.next.clips.find((clip) => clip.clipId === 'target');
            return projectChannelBend({
                clips: [
                    {
                        clip: { startBeat: 0, endBeat: 8 },
                        controlChanges: target?.data.controlChanges.value ?? [],
                        pitchBends: target?.data.pitchBends.value ?? [],
                    },
                ],
                frameAtBeat: (beat) => beat * 24_000,
            }).map(({ beat, rangeSemitones }) => ({ beat, rangeSemitones }));
        }

        it('plays a source trimmed after the take declared its range at the range the source played', () => {
            mocks.state.value = {
                notesByClipId: {},
                ccByClipId: { 'source-a': nullTerminatedRange('range', 0.5, 12) },
                pitchBendByClipId: { 'source-a': [{ id: 'bend', value: 4096, beat: 3, channel: 0 }] },
            };
            const trimmed = [
                { clipId: 'source-a', beatOffset: -2, visibleStartBeat: 2, visibleEndBeat: 4 },
                { clipId: 'source-b', beatOffset: 2, visibleStartBeat: 0, visibleEndBeat: 4 },
            ];

            const plan = prepareMidiClipGlueState({ sources: trimmed, targetClipId: 'target' });
            const target = plan?.next.clips.find((clip) => clip.clipId === 'target');

            expect(rangesPlayed(plan)).toEqual([{ beat: 1, rangeSemitones: 12 }]);
            // The declaration opens the window where it starts in the glued clip; the next source's head, where
            // the range the trimmed source declared is returned to the default, is on the seam at beat 2.
            expect(target?.data.controlChanges.value.map(({ beat }) => beat)).toEqual([
                0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2,
            ]);
            expect(new Set(target?.data.controlChanges.value.map(({ id }) => id)).size).toBe(12);
        });

        it('reads the rows of the sources in beat order, whatever order they are stored in', () => {
            mocks.state.value = {
                notesByClipId: {},
                ccByClipId: { 'source-a': nullTerminatedRange('range', 0.5, 12).toReversed() },
                pitchBendByClipId: { 'source-b': [{ id: 'bend-b', value: 4096, beat: 1, channel: 0 }] },
            };

            const plan = prepareMidiClipGlueState({ sources, targetClipId: 'target' });

            expect(rangesPlayed(plan)).toEqual([{ beat: 5, rangeSemitones: 2 }]);
        });

        it('counts a message on the window start once: it is the window’s own row, not one the window is cut away from', () => {
            mocks.state.value = {
                notesByClipId: {},
                ccByClipId: {
                    'source-a': [
                        row('rpn-msb', 0.5, 101, 0),
                        row('rpn-lsb', 0.75, 100, 0),
                        row('data-msb', 1, 6, 2),
                        row('increment-on-start', 2, 96, 0),
                    ],
                },
                pitchBendByClipId: { 'source-a': [{ id: 'bend', value: 4096, beat: 3, channel: 0 }] },
            };
            const trimmed = [
                { clipId: 'source-a', beatOffset: -2, visibleStartBeat: 2, visibleEndBeat: 4 },
                { clipId: 'source-b', beatOffset: 2, visibleStartBeat: 0, visibleEndBeat: 4 },
            ];

            const plan = prepareMidiClipGlueState({ sources: trimmed, targetClipId: 'target' });

            expect(rangesPlayed(plan)).toEqual([{ beat: 1, rangeSemitones: 3 }]);
        });

        it('plays a source that declared no range at the default, not at the range of the source before it', () => {
            mocks.state.value = {
                notesByClipId: {},
                ccByClipId: { 'source-a': nullTerminatedRange('range', 0.5, 12) },
                pitchBendByClipId: {
                    'source-a': [{ id: 'bend-a', value: 4096, beat: 3, channel: 0 }],
                    'source-b': [{ id: 'bend-b', value: 4096, beat: 1, channel: 0 }],
                },
            };

            const plan = prepareMidiClipGlueState({ sources, targetClipId: 'target' });

            expect(rangesPlayed(plan)).toEqual([
                { beat: 3, rangeSemitones: 12 },
                { beat: 5, rangeSemitones: 2 },
            ]);
        });

        it('plays each source at the range it declared itself', () => {
            mocks.state.value = {
                notesByClipId: {},
                ccByClipId: {
                    'source-a': nullTerminatedRange('range-a', 0.5, 12),
                    'source-b': nullTerminatedRange('range-b', 0.5, 24),
                },
                pitchBendByClipId: {
                    'source-a': [{ id: 'bend-a', value: 4096, beat: 3, channel: 0 }],
                    'source-b': [{ id: 'bend-b', value: 4096, beat: 3, channel: 0 }],
                },
            };

            const plan = prepareMidiClipGlueState({ sources, targetClipId: 'target' });

            expect(rangesPlayed(plan)).toEqual([
                { beat: 3, rangeSemitones: 12 },
                { beat: 7, rangeSemitones: 24 },
            ]);
        });

        describe('a bend the trimmed source carries onto its window start', () => {
            /** RPN 0 = `semitones`, every message on `beat`. */
            function rangeAt(prefix: string, beat: number, semitones: number): Row[] {
                return [
                    row(`${prefix}-msb`, beat, 101, 0),
                    row(`${prefix}-lsb`, beat, 100, 0),
                    row(`${prefix}-data-msb`, beat, 6, semitones),
                    row(`${prefix}-data-lsb`, beat, 38, 0),
                ];
            }

            const recordedUnderTwelve = [...rangeAt('twelve', 0.1, 12), ...rangeAt('two', 1.3, 2)];
            const carried = { id: 'carried', value: 8191, beat: 1.2, channel: 0 };
            const trimmedSources = [
                { clipId: 'source-a', beatOffset: -1.35, visibleStartBeat: 1.35, visibleEndBeat: 4 },
                { clipId: 'source-b', beatOffset: 2.65, visibleStartBeat: 0, visibleEndBeat: 4 },
            ];

            /** The depth each move of source A's bend plays under, on the clip trimmed to start at content beat 1.35. */
            function rangesTheTrimmedSourcePlayed(
                controlChanges: readonly Row[],
                pitchBends: readonly (typeof carried)[]
            ) {
                return projectChannelBend({
                    clips: [
                        { clip: { startBeat: 0, endBeat: 2.65, midiOffsetBeats: 1.35 }, controlChanges, pitchBends },
                    ],
                    frameAtBeat: (beat) => beat * 24_000,
                }).map(({ beat, rangeSemitones }) => ({ beat, rangeSemitones }));
            }

            it('plays the carried bend at the range its row was recorded under, as the trimmed source did', () => {
                mocks.state.value = {
                    notesByClipId: {},
                    ccByClipId: { 'source-a': recordedUnderTwelve },
                    pitchBendByClipId: { 'source-a': [carried] },
                };

                const plan = prepareMidiClipGlueState({ sources: trimmedSources, targetClipId: 'target' });

                expect(rangesTheTrimmedSourcePlayed(recordedUnderTwelve, [carried])).toEqual([
                    { beat: 0, rangeSemitones: 12 },
                ]);
                expect(rangesPlayed(plan)).toEqual([{ beat: 0, rangeSemitones: 12 }]);
            });

            it('plays the window’s own later rows at the range in force at the window start', () => {
                const later = { id: 'later', value: 4096, beat: 2, channel: 0 };
                const dataEntry = row('data-entry-after', 3, 6, 5);
                mocks.state.value = {
                    notesByClipId: {},
                    ccByClipId: { 'source-a': [...recordedUnderTwelve, dataEntry] },
                    pitchBendByClipId: {
                        'source-a': [carried, later, { id: 'after-data-entry', value: 4096, beat: 3.5, channel: 0 }],
                    },
                };

                const plan = prepareMidiClipGlueState({ sources: trimmedSources, targetClipId: 'target' });
                const played = [
                    { beat: 0, rangeSemitones: 12 },
                    { beat: 2 - 1.35, rangeSemitones: 2 },
                    { beat: 3.5 - 1.35, rangeSemitones: 5 },
                ];

                expect(
                    rangesTheTrimmedSourcePlayed(
                        [...recordedUnderTwelve, dataEntry],
                        mocks.state.value.pitchBendByClipId['source-a'] ?? []
                    )
                ).toEqual(played);
                expect(rangesPlayed(plan)).toEqual(played);
            });

            /** The depth each bend of the glued clip plays under, with `added` drawn onto it after the glue. */
            function rangesPlayedWith(plan: ReturnType<typeof prepareMidiClipGlueState>, added: typeof carried) {
                const target = plan?.next.clips.find((clip) => clip.clipId === 'target');
                const gluedBends = target?.data.pitchBends.value ?? [];
                return projectChannelBend({
                    clips: [
                        {
                            clip: { startBeat: 0, endBeat: 8 },
                            controlChanges: target?.data.controlChanges.value ?? [],
                            pitchBends: [...gluedBends, added],
                        },
                    ],
                    frameAtBeat: (beat) => beat * 24_000,
                }).map(({ beat, rangeSemitones }) => ({ beat, rangeSemitones }));
            }

            it.each([
                { name: 'no row of its own after the window start', controlChanges: recordedUnderTwelve },
                {
                    name: 'its first row of its own after the added bend',
                    controlChanges: [...recordedUnderTwelve, row('volume-after', 3.5, 7, 100)],
                },
            ])(
                'plays a bend added after the carried one at the range in force at the window start, with $name',
                ({ controlChanges }) => {
                    mocks.state.value = {
                        notesByClipId: {},
                        ccByClipId: { 'source-a': controlChanges },
                        pitchBendByClipId: { 'source-a': [carried] },
                    };

                    const plan = prepareMidiClipGlueState({ sources: trimmedSources, targetClipId: 'target' });

                    expect(rangesPlayedWith(plan, { id: 'added', value: 4096, beat: 1, channel: 0 })).toEqual([
                        { beat: 0, rangeSemitones: 12 },
                        { beat: 1, rangeSemitones: 2 },
                    ]);
                }
            );

            it('returns to the state at the window start inside a window shorter than the return offset', () => {
                const windowLength = 1 / 2000;
                mocks.state.value = {
                    notesByClipId: {},
                    ccByClipId: { 'source-a': recordedUnderTwelve, 'source-b': rangeAt('b', 0, 5) },
                    pitchBendByClipId: { 'source-a': [carried] },
                };
                const sources = [
                    {
                        clipId: 'source-a',
                        beatOffset: -1.35,
                        visibleStartBeat: 1.35,
                        visibleEndBeat: 1.35 + windowLength,
                    },
                    { clipId: 'source-b', beatOffset: windowLength, visibleStartBeat: 0, visibleEndBeat: 4 },
                ];

                const plan = prepareMidiClipGlueState({ sources, targetClipId: 'target' });

                expect(rangesPlayedWith(plan, { id: 'added', value: 4096, beat: 1, channel: 0 })).toEqual([
                    { beat: 0, rangeSemitones: 12 },
                    { beat: 1, rangeSemitones: 5 },
                ]);
            });

            it('returns to the state at the window start ahead of a Data Entry of its own on the beat the return takes', () => {
                const controlChanges = [...recordedUnderTwelve, row('data-entry-first', 2.5, 6, 5)];
                const pitchBends = [carried, { id: 'after-data-entry', value: 4096, beat: 3, channel: 0 }];
                mocks.state.value = {
                    notesByClipId: {},
                    ccByClipId: { 'source-a': controlChanges },
                    pitchBendByClipId: { 'source-a': pitchBends },
                };

                const plan = prepareMidiClipGlueState({ sources: trimmedSources, targetClipId: 'target' });
                const played = [
                    { beat: 0, rangeSemitones: 12 },
                    { beat: 3 - 1.35, rangeSemitones: 5 },
                ];

                expect(rangesTheTrimmedSourcePlayed(controlChanges, pitchBends)).toEqual(played);
                expect(rangesPlayed(plan)).toEqual(played);
            });

            it.each([
                {
                    name: 'a bend',
                    controlChanges: recordedUnderTwelve,
                    pitchBends: [carried, { id: 'own', value: 4096, beat: 1.35 + 1e-12, channel: 0 }],
                    range: 2,
                },
                {
                    name: 'a Data Entry',
                    controlChanges: [...recordedUnderTwelve, row('own-data-entry', 1.35 + 1e-12, 6, 5)],
                    pitchBends: [carried, { id: 'later', value: 4096, beat: 3, channel: 0 }],
                    range: 5,
                },
            ])(
                'reads the state in force at the window start for $name of its own within the same-beat tolerance of it',
                ({ controlChanges, pitchBends, range }) => {
                    mocks.state.value = {
                        notesByClipId: {},
                        ccByClipId: { 'source-a': controlChanges },
                        pitchBendByClipId: { 'source-a': pitchBends },
                    };

                    const plan = prepareMidiClipGlueState({ sources: trimmedSources, targetClipId: 'target' });

                    expect(rangesTheTrimmedSourcePlayed(controlChanges, pitchBends).at(-1)?.rangeSemitones).toBe(range);
                    expect(rangesPlayed(plan).at(-1)?.rangeSemitones).toBe(range);
                }
            );

            it('adds nothing for a carried bend recorded under the state in force at the window start', () => {
                const rangeTwelve = rangeAt('twelve', 0.1, 12);
                mocks.state.value = {
                    notesByClipId: {},
                    ccByClipId: { 'source-a': rangeTwelve },
                    pitchBendByClipId: {},
                };
                const withoutBend = prepareMidiClipGlueState({ sources: trimmedSources, targetClipId: 'target' });
                mocks.state.value = {
                    notesByClipId: {},
                    ccByClipId: { 'source-a': rangeTwelve },
                    pitchBendByClipId: { 'source-a': [carried] },
                };

                const plan = prepareMidiClipGlueState({ sources: trimmedSources, targetClipId: 'target' });
                const controllersOf = (glue: typeof plan) =>
                    glue?.next.clips.find((clip) => clip.clipId === 'target')?.data.controlChanges.value;

                expect(controllersOf(plan)).toEqual(controllersOf(withoutBend));
                expect(rangesPlayed(plan)).toEqual([{ beat: 0, rangeSemitones: 12 }]);
            });
        });

        it('adds nothing to a glue whose sources never addressed a registered parameter', () => {
            mocks.state.value = {
                notesByClipId: {},
                ccByClipId: { 'source-a': [row('pedal', 1, 64, 127)] },
                pitchBendByClipId: {},
            };

            const plan = prepareMidiClipGlueState({ sources, targetClipId: 'target' });
            const target = plan?.next.clips.find((clip) => clip.clipId === 'target');

            expect(target?.data.controlChanges.value.map(({ id }) => id)).toEqual(['pedal']);
        });
    });
});
