import { executeUserAppAction } from '#/modules/Command/useCases';
import { sliceMidiTakeNoteForEdit } from '#/modules/MIDI/useCases';

import { type MidiNote } from '../../models/MidiNoteViewTypes';

import { type PianoRollTakeNotes } from './projectPianoRollTakeNotes';

type NoteChange = Partial<
    Pick<MidiNote, 'pitch' | 'startBeat' | 'duration' | 'velocity' | 'pressure' | 'slide' | 'pitchBend' | 'probability'>
>;

/** The one selected-take edit route. View IDs never enter persisted source rows. */
export async function editPianoRollTakeNote(
    projection: PianoRollTakeNotes,
    viewId: string,
    change: NoteChange | null
): Promise<boolean> {
    const owner = projection.ownersByViewId.get(viewId);
    if (!owner) {
        return false;
    }
    const expected = owner.row;
    let startBeat = expected.startBeat;
    let duration = expected.duration;
    if (change?.startBeat !== undefined) {
        startBeat += change.startBeat - owner.displayedStartBeat;
    }
    if (change?.duration !== undefined) {
        duration += change.duration - owner.displayedDuration;
    }
    let resized = expected;
    if (change?.duration !== undefined && (startBeat !== expected.startBeat || duration !== expected.duration)) {
        resized = sliceMidiTakeNoteForEdit(expected, { fromOffset: startBeat - expected.startBeat, duration });
    }
    let replacement: MidiNote | null = null;
    if (change !== null) {
        replacement = { ...resized, ...change, startBeat, duration };
    }
    await executeUserAppAction({
        type: 'replaceOriginalMidiTakeRow',
        payload: {
            laneId: owner.laneId,
            takeId: owner.takeId,
            sourceClipId: owner.sourceClipId,
            rowId: expected.id,
            rowKind: 'note',
            copyScope: 'capture',
            expected,
            replacement,
            expectedSlotPresent: true,
            replacementSlotPresent: true,
        },
    });
    return true;
}

/** Insert into the selected occurrence's source pass; base gaps stay on the existing clip route. */
export async function insertPianoRollTakeNote(
    projection: PianoRollTakeNotes,
    clipBeat: number,
    note: Omit<MidiNote, 'id' | 'startBeat'>
): Promise<string | null> {
    const owner = projection.insertOwnerAtBeat(clipBeat);
    if (!owner) {
        return null;
    }
    const id = crypto.randomUUID();
    const { recordingPassIndex: _previousPass, ...fields } = note;
    const replacement: MidiNote = { ...fields, id, startBeat: owner.sourceBeat };
    if (owner.recordingPassIndex !== undefined) {
        replacement.recordingPassIndex = owner.recordingPassIndex;
    }
    await executeUserAppAction({
        type: 'replaceOriginalMidiTakeRow',
        payload: {
            laneId: owner.laneId,
            takeId: owner.takeId,
            sourceClipId: owner.sourceClipId,
            rowId: id,
            rowKind: 'note',
            copyScope: 'capture',
            expected: null,
            replacement,
            expectedSlotPresent: owner.slotPresent,
            replacementSlotPresent: true,
        },
    });
    return id;
}
