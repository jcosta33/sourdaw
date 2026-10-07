import { midiStore } from '#/modules/MIDI/stores';

import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNoteViewTypes';
import { type Clip } from '../../models/Track';

/**
 * The MIDI rows a clip carries, cloned for the clipboard snapshot: the notes
 * plus the two controller streams, the records the MIDI store holds under the
 * clip id. Only a midi clip holds rows — anything else captures nothing — and
 * the clones make the payload self-contained: the source clip may be deleted
 * before the paste, and a duplicate carries all three streams
 * (`duplicateMidiClipData`), so a paste must too.
 */
export function captureMidiClipRows(clip: Clip): {
    midiNotes: MidiNote[] | undefined;
    midiCC: MidiCC[] | undefined;
    midiPitchBend: MidiPitchBend[] | undefined;
} {
    if (clip.type !== 'midi') {
        return { midiNotes: undefined, midiCC: undefined, midiPitchBend: undefined };
    }
    const state = midiStore.value;
    const notes = state?.notesByClipId[clip.id];
    const controlChanges = state?.ccByClipId[clip.id];
    const pitchBends = state?.pitchBendByClipId[clip.id];
    return {
        midiNotes: notes && structuredClone(notes),
        midiCC: controlChanges && structuredClone(controlChanges),
        midiPitchBend: pitchBends && structuredClone(pitchBends),
    };
}
