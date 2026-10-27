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
    const startBeat =
        change?.startBeat === undefined
            ? expected.startBeat
            : expected.startBeat + change.startBeat - owner.displayedStartBeat;
    const duration =
        change?.duration === undefined
            ? expected.duration
            : expected.duration + change.duration - owner.displayedDuration;
    const resized =
        startBeat === expected.startBeat && duration === expected.duration
            ? expected
            : sliceMidiTakeNoteForEdit(expected, { fromOffset: startBeat - expected.startBeat, duration });
    const replacement =
        change === null
            ? null
            : {
                  ...resized,
                  ...change,
                  startBeat,
                  duration,
              };
    await executeUserAppAction({
        type: 'replaceOriginalMidiTakeRow',
        payload: {
            laneId: owner.laneId,
            takeId: owner.takeId,
            sourceClipId: owner.sourceClipId,
            rowId: expected.id,
            rowKind: 'note',
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
    await executeUserAppAction({
        type: 'replaceOriginalMidiTakeRow',
        payload: {
            laneId: owner.laneId,
            takeId: owner.takeId,
            sourceClipId: owner.sourceClipId,
            rowId: id,
            rowKind: 'note',
            expected: null,
            replacement: {
                ...fields,
                id,
                startBeat: owner.sourceBeat,
                ...(owner.recordingPassIndex === undefined ? {} : { recordingPassIndex: owner.recordingPassIndex }),
            },
            expectedSlotPresent: owner.slotPresent,
            replacementSlotPresent: true,
        },
    });
    return id;
}
