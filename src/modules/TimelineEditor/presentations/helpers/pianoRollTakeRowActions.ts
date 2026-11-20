import { type projectPianoRollTakeNotes } from '#/modules/MIDI/useCases';

import { type MidiNote } from '../../models/MidiNoteViewTypes';

import { baseRowAction, executeRows, rowAction } from './applyPianoRollTakeMenuAction';

type PianoRollTakeNotes = ReturnType<typeof projectPianoRollTakeNotes>;
type FrozenPianoRollNoteOwner = NonNullable<ReturnType<PianoRollTakeNotes['ownersByViewId']['get']>>;

type RowAction = ReturnType<typeof rowAction>;
type BaseRowAction = ReturnType<typeof baseRowAction>;

type MoveOwner = {
    clipId: string;
    id: string;
    beat: number;
    displayBeat: number;
    pitch: number;
    owner: FrozenPianoRollNoteOwner | undefined;
    row: MidiNote | undefined;
};

export async function movePianoRollTakeRows(positions: readonly MoveOwner[]): Promise<boolean> {
    const actions: (RowAction | BaseRowAction)[] = [];
    const seen = new Set<string>();
    for (const param of positions) {
        const { owner, row } = param;
        let key = JSON.stringify(['base', param.clipId, param.id]);
        if (owner) {
            key = JSON.stringify(['take', owner.sourceClipId, owner.row.id]);
        }
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        if (owner) {
            actions.push(
                rowAction(owner, {
                    ...owner.row,
                    pitch: param.pitch,
                    startBeat: owner.row.startBeat + (param.displayBeat - owner.displayedStartBeat),
                })
            );
        } else if (row) {
            actions.push(baseRowAction(param.clipId, row, { ...row, pitch: param.pitch, startBeat: param.beat }));
        } else {
            return false;
        }
    }
    return executeRows(actions, `Move ${actions.length} note${actions.length > 1 ? 's' : ''}`);
}
