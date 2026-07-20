import { beforeEach, describe, expect, it } from 'vitest';

import { LEGACY_MIDI_PROBABILITY_SEED, midiStore } from '../../stores/midiStore';
import { mergeImportedMidiClipNotes } from '../mergeImportedMidiClipNotes';

const existingNote = {
    id: 'note-existing',
    pitch: 48,
    startBeat: 0,
    duration: 1,
    velocity: 100,
};

const importedNote = {
    id: 'note-imported',
    pitch: 60,
    startBeat: 2,
    duration: 0.5,
    velocity: 110,
};

describe('mergeImportedMidiClipNotes', () => {
    beforeEach(() => {
        midiStore.set({
            probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
            notesByClipId: { 'existing-clip': [existingNote] },
            ccByClipId: {
                'existing-clip': [{ id: 'cc-existing', controller: 1, value: 64, beat: 0, channel: 0 }],
            },
            pitchBendByClipId: {
                'existing-clip': [{ id: 'pitch-existing', value: 128, beat: 0, channel: 0 }],
            },
        });
    });

    it('merges imported notes with the MIDI state available at write time', () => {
        mergeImportedMidiClipNotes({
            notesByClipId: { 'imported-clip': [importedNote] },
        });

        expect(midiStore.value).toEqual({
            probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
            notesByClipId: {
                'existing-clip': [existingNote],
                'imported-clip': [importedNote],
            },
            ccByClipId: {
                'existing-clip': [{ id: 'cc-existing', controller: 1, value: 64, beat: 0, channel: 0 }],
            },
            pitchBendByClipId: {
                'existing-clip': [{ id: 'pitch-existing', value: 128, beat: 0, channel: 0 }],
            },
        });
    });

    it('establishes default MIDI state when the store is unavailable', () => {
        midiStore.set(null);

        mergeImportedMidiClipNotes({
            notesByClipId: { 'imported-clip': [importedNote] },
        });

        expect(midiStore.value).toEqual({
            probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
            notesByClipId: { 'imported-clip': [importedNote] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('restores collided notes without deleting other MIDI data and refreshes the snapshot on redo', () => {
        const replacementNote = { ...importedNote, id: 'note-replacement' };
        const betweenCyclesNote = { ...existingNote, id: 'note-between-cycles' };
        const change = mergeImportedMidiClipNotes({
            notesByClipId: { 'existing-clip': [replacementNote] },
        });

        change.undo();
        expect(midiStore.value?.notesByClipId['existing-clip']).toEqual([existingNote]);
        expect(midiStore.value?.ccByClipId['existing-clip']).toHaveLength(1);
        expect(midiStore.value?.pitchBendByClipId['existing-clip']).toHaveLength(1);

        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {
                ...midiStore.value!.notesByClipId,
                'existing-clip': [betweenCyclesNote],
            },
        });

        change.redo();
        expect(midiStore.value?.notesByClipId['existing-clip']).toEqual([replacementNote]);

        change.undo();
        expect(midiStore.value?.notesByClipId['existing-clip']).toEqual([betweenCyclesNote]);
        expect(midiStore.value?.ccByClipId['existing-clip']).toHaveLength(1);
        expect(midiStore.value?.pitchBendByClipId['existing-clip']).toHaveLength(1);
    });
});
