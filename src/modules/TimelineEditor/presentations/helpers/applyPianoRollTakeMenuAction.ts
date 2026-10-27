import { copyPianoRollNotes, getCopiedPianoRollNotes } from '#/modules/Arrangement/useCases';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import {
    projectMidiNoteMenuTransform,
    sliceMidiTakeNoteForEdit,
    type MidiNoteMenuTransform,
} from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type MidiNote } from '../../models/MidiNoteViewTypes';

import { type FrozenPianoRollNoteOwner, type PianoRollTakeNotes } from './projectPianoRollTakeNotes';

type RowAction = Extract<AppAction, { type: 'replaceOriginalMidiTakeRow' }>;
type SelectedOccurrence = { display: MidiNote; owner: FrozenPianoRollNoteOwner };

function originalKey(owner: FrozenPianoRollNoteOwner): string {
    return JSON.stringify([owner.sourceClipId, owner.row.id]);
}

function uniqueOccurrences(projection: PianoRollTakeNotes, selectedNoteIds: ReadonlySet<string>): SelectedOccurrence[] {
    const selected =
        selectedNoteIds.size > 0 ? projection.notes.filter((note) => selectedNoteIds.has(note.id)) : projection.notes;
    const seen = new Set<string>();
    return selected.flatMap((display) => {
        const owner = projection.ownersByViewId.get(display.id);
        if (!owner) {
            return [];
        }
        const key = originalKey(owner);
        if (seen.has(key)) {
            return [];
        }
        seen.add(key);
        return [{ display, owner }];
    });
}

function rowAction(owner: FrozenPianoRollNoteOwner, replacement: MidiNote | null): RowAction {
    return {
        type: 'replaceOriginalMidiTakeRow',
        payload: {
            laneId: owner.laneId,
            takeId: owner.takeId,
            sourceClipId: owner.sourceClipId,
            rowId: owner.row.id,
            rowKind: 'note',
            expected: owner.row,
            replacement,
            expectedSlotPresent: true,
            replacementSlotPresent: true,
        },
    };
}

async function executeRows(
    actions: readonly RowAction[],
    label: string,
    groupId = crypto.randomUUID()
): Promise<boolean> {
    if (actions.length === 0) {
        return true;
    }
    const result = await executeAppActionBatch(actions, { groupId, groupLabel: label });
    return result.status === 'committed' || result.status === 'committed-with-warning' || result.status === 'no-op';
}

function editedSourceRow(owner: FrozenPianoRollNoteOwner, transformed: MidiNote): MidiNote {
    const row = owner.row;
    const startBeat = owner.sourceEntryBeat + transformed.startBeat;
    const duration = transformed.duration;
    const resized =
        duration === row.duration
            ? row
            : sliceMidiTakeNoteForEdit(row, { fromOffset: startBeat - row.startBeat, duration });
    return { ...resized, startBeat, duration, pitch: transformed.pitch, velocity: transformed.velocity };
}

/** Transform each original row once on the recorded source/pass grid, then project all aliases from it. */
export async function transformPianoRollTakeNotes(
    projection: PianoRollTakeNotes,
    selectedNoteIds: ReadonlySet<string>,
    transform: MidiNoteMenuTransform,
    label: string
): Promise<boolean> {
    const selected = uniqueOccurrences(projection, selectedNoteIds);
    const localNotes = selected.map(({ owner }) => ({
        ...owner.row,
        startBeat: owner.row.startBeat - owner.sourceEntryBeat,
    }));
    const transformed = projectMidiNoteMenuTransform(localNotes, transform);
    const actions: RowAction[] = [];
    for (const [index, { owner }] of selected.entries()) {
        const output = transformed[index];
        if (!output) {
            return false;
        }
        actions.push(rowAction(owner, editedSourceRow(owner, output)));
    }
    return executeRows(
        actions.filter((action) => !valuesEqual(action.payload.expected, action.payload.replacement)),
        label
    );
}

export function copyPianoRollTakeNotes(projection: PianoRollTakeNotes, selectedNoteIds: ReadonlySet<string>): void {
    const seen = new Set<string>();
    const selected = [...projection.notes, ...projection.baseNotes].filter((note) => selectedNoteIds.has(note.id));
    copyPianoRollNotes(
        selected.filter((note) => {
            const frozen = projection.ownersByViewId.get(note.id);
            const base = projection.baseOwnersByViewId.get(note.id);
            const key = frozen ? originalKey(frozen) : JSON.stringify(['base', base?.row.id ?? note.id]);
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        })
    );
}

export async function deletePianoRollTakeNotes(
    projection: PianoRollTakeNotes,
    selectedNoteIds: ReadonlySet<string>,
    label: string,
    groupId?: string
): Promise<boolean> {
    return executeRows(
        uniqueOccurrences(projection, selectedNoteIds).map(({ owner }) => rowAction(owner, null)),
        label,
        groupId
    );
}

async function insertOccurrences(
    projection: PianoRollTakeNotes,
    positions: readonly { note: MidiNote; beat: number }[],
    label: string
): Promise<boolean> {
    const actions: RowAction[] = [];
    for (const { note, beat } of positions) {
        const owner = projection.insertOwnerAtBeat(beat);
        if (!owner) {
            return false;
        }
        const id = crypto.randomUUID();
        const sourceAlreadyInserted = actions.some((action) => action.payload.sourceClipId === owner.sourceClipId);
        const { id: _viewId, startBeat: _viewBeat, recordingPassIndex: _previousPass, ...fields } = note;
        actions.push({
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
                expectedSlotPresent: sourceAlreadyInserted ? true : owner.slotPresent,
                replacementSlotPresent: true,
            },
        });
    }
    return executeRows(actions, label);
}

export async function pastePianoRollTakeNotes(projection: PianoRollTakeNotes, beat: number): Promise<boolean> {
    const copied = getCopiedPianoRollNotes();
    if (copied.length === 0) {
        return true;
    }
    const firstBeat = Math.min(...copied.map((note) => note.startBeat));
    return insertOccurrences(
        projection,
        copied.map((note) => ({ note, beat: note.startBeat - firstBeat + beat })),
        'Paste MIDI take notes'
    );
}

export async function duplicatePianoRollTakeNotes(
    projection: PianoRollTakeNotes,
    selectedNoteIds: ReadonlySet<string>
): Promise<boolean> {
    const selected = uniqueOccurrences(projection, selectedNoteIds).map(({ display }) => display);
    if (selected.length === 0) {
        return true;
    }
    const firstBeat = Math.min(...selected.map((note) => note.startBeat));
    const lastEnd = Math.max(...selected.map((note) => note.startBeat + note.duration));
    const span = lastEnd - firstBeat;
    return insertOccurrences(
        projection,
        selected.map((note) => ({ note, beat: note.startBeat + span })),
        'Duplicate MIDI take notes'
    );
}
