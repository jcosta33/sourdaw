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
                    { id: 'z-down', value: -0.5, beat: 3, channel: 0 },
                    { id: 'a-up', value: 0.5, beat: 3, channel: 0 },
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
            ['z-down', -0.5],
            ['a-up', 0.5],
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
                    { id: 'bend-hidden', value: 0.25, beat: 1, channel: 2 },
                    { id: 'bend-late', value: 0.75, beat: 5, channel: 2 },
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
            ['bend-hidden', 6, 0.25],
            ['bend-late', 9, 0.75],
        ]);
    });
});
