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
                generated: [{ id: 'bend-1', value: 0.25, beat: 0, channel: 0 }],
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
                    value: [{ id: 'bend-1', value: 0.25, beat: 0, channel: 0 }],
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
});
