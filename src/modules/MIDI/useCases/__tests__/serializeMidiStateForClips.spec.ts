import { beforeEach, describe, expect, it } from 'vitest';

import { midiStore } from '../../stores/midiStore';
import { serializeMidiStateForClips } from '../serializeMidiStateForClips';

describe('serializeMidiStateForClips', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('captures every MIDI bucket and migration marker for the requested clips', () => {
        midiStore.set({
            notesByClipId: {
                generated: [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            },
            ccByClipId: {
                generated: [{ id: 'cc-1', controller: 1, value: 0.5, beat: 0, channel: 0 }],
            },
            pitchBendByClipId: {
                generated: [{ id: 'bend-1', value: 2048, beat: 0, channel: 0 }],
            },
            migratedAbsoluteNoteClipIds: ['generated'],
        });

        expect(JSON.parse(serializeMidiStateForClips(['generated', 'empty']))).toEqual({
            generated: {
                notes: {
                    present: true,
                    value: [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
                },
                cc: {
                    present: true,
                    value: [{ id: 'cc-1', controller: 1, value: 0.5, beat: 0, channel: 0 }],
                },
                pitchBends: {
                    present: true,
                    value: [{ id: 'bend-1', value: 2048, beat: 0, channel: 0 }],
                },
                migrated: true,
            },
            empty: {
                notes: { present: false, value: [] },
                cc: { present: false, value: [] },
                pitchBends: { present: false, value: [] },
                migrated: false,
            },
        });
    });

    it('distinguishes absent buckets from present empty buckets', () => {
        midiStore.set({
            notesByClipId: { initialized: [] },
            ccByClipId: { initialized: [] },
            pitchBendByClipId: { initialized: [] },
        });

        const serialized = serializeMidiStateForClips(['initialized', 'absent']);

        expect(JSON.parse(serialized)).toMatchObject({
            initialized: {
                notes: { present: true, value: [] },
                cc: { present: true, value: [] },
                pitchBends: { present: true, value: [] },
            },
            absent: {
                notes: { present: false, value: [] },
                cc: { present: false, value: [] },
                pitchBends: { present: false, value: [] },
            },
        });
    });

    it('serializes what the prior batch members restore when they are given', () => {
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        const note = { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
        const cc = { id: 'cc-1', controller: 64, value: 127, beat: 2, channel: 0 };

        const serialized = serializeMidiStateForClips(
            ['copy'],
            [
                {
                    type: 'restoreClip',
                    payload: {
                        clipId: 'copy',
                        trackId: 'track-1',
                        clipSnapshot: { id: 'copy', trackId: 'track-1', startBeat: 0, endBeat: 4 },
                        ripplePlan: null,
                        midiNotesSnapshot: [note],
                        midiCcSnapshot: [cc],
                        midiPitchBendSnapshot: null,
                        retiredTakeLanes: [],
                    },
                },
            ]
        );

        expect(JSON.parse(serialized)).toEqual({
            copy: {
                notes: { present: true, value: [note] },
                cc: { present: true, value: [cc] },
                pitchBends: { present: false, value: [] },
                migrated: false,
            },
        });
        expect(JSON.parse(serializeMidiStateForClips(['copy']))).toMatchObject({
            copy: { notes: { present: false }, cc: { present: false } },
        });
    });
});
