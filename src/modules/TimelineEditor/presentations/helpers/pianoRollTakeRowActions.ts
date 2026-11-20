import { executeAppActionBatch } from '#/modules/Command/useCases';
import { type projectPianoRollTakeNotes } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type MidiNote } from '../../models/MidiNoteViewTypes';

type PianoRollTakeNotes = ReturnType<typeof projectPianoRollTakeNotes>;
type FrozenPianoRollNoteOwner = NonNullable<ReturnType<PianoRollTakeNotes['ownersByViewId']['get']>>;

export type RowAction = Extract<AppAction, { type: 'replaceOriginalMidiTakeRow' }>;
export type BaseRowAction = Extract<AppAction, { type: 'replaceOriginalMidiBaseRow' }>;

export function rowAction(owner: FrozenPianoRollNoteOwner, replacement: MidiNote | null): RowAction {
    return {
        type: 'replaceOriginalMidiTakeRow',
        payload: {
            laneId: owner.laneId,
            takeId: owner.takeId,
            sourceClipId: owner.sourceClipId,
            rowId: owner.row.id,
            rowKind: 'note',
            copyScope: 'capture',
            expected: owner.row,
            replacement,
            expectedSlotPresent: true,
            replacementSlotPresent: true,
        },
    };
}

export function baseRowAction(
    clipId: string,
    row: MidiNote | null,
    replacement: MidiNote | null,
    options: { rowId?: string; expectedSlotPresent?: boolean } = {}
): BaseRowAction {
    return {
        type: 'replaceOriginalMidiBaseRow',
        payload: {
            clipId,
            rowId: options.rowId ?? row?.id ?? replacement?.id ?? '',
            expected: row,
            replacement,
            expectedSlotPresent: options.expectedSlotPresent ?? true,
            replacementSlotPresent: true,
        },
    };
}

export async function executeRows(
    actions: readonly (RowAction | BaseRowAction)[],
    label: string,
    groupId = crypto.randomUUID()
): Promise<boolean> {
    if (actions.length === 0) {
        return true;
    }
    const result = await executeAppActionBatch(actions, { groupId, groupLabel: label });
    return result.status === 'committed' || result.status === 'committed-with-warning' || result.status === 'no-op';
}

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
