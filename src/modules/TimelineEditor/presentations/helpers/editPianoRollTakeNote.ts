import { executeUserAppAction } from '#/modules/Command/useCases';

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
    const replacement =
        change === null
            ? null
            : {
                  ...expected,
                  ...change,
                  startBeat:
                      change.startBeat === undefined
                          ? expected.startBeat
                          : expected.startBeat + change.startBeat - owner.displayedStartBeat,
                  duration:
                      change.duration === undefined
                          ? expected.duration
                          : expected.duration + change.duration - owner.displayedDuration,
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
    note: Pick<MidiNote, 'pitch' | 'duration' | 'velocity'>
): Promise<string | null> {
    const owner = projection.insertOwnerAtBeat(clipBeat);
    if (!owner) {
        return null;
    }
    const id = crypto.randomUUID();
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
                id,
                pitch: note.pitch,
                startBeat: owner.sourceBeat,
                duration: note.duration,
                velocity: note.velocity,
                ...(owner.recordingPassIndex === undefined ? {} : { recordingPassIndex: owner.recordingPassIndex }),
            },
            expectedSlotPresent: owner.slotPresent,
            replacementSlotPresent: true,
        },
    });
    return id;
}
