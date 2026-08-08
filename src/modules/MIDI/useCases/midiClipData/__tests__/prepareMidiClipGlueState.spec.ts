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

    it('orders equal-time Unicode row ids by UTF-16 code unit', () => {
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
        expect(target?.data.controlChanges.value.map((controlChange) => controlChange.id)).toEqual(['z-cc', 'é-cc']);
        expect(target?.data.pitchBends.value.map((pitchBend) => pitchBend.id)).toEqual(['z-bend', 'é-bend']);
    });
});
