import { replaceFrozenMidiTakeRow } from '#/modules/MIDI/useCases';
import { type OriginalMidiTakeRowReplacementPayload } from '#/utils/handlerContract';

import { type MidiTakeSource } from '../../models/TakeLane';
import { takeLaneStore, type TakeLaneStoreState } from '../../stores/takeLaneStore';

type RowEdit = Parameters<typeof replaceFrozenMidiTakeRow>[1];

function rowEdit(input: OriginalMidiTakeRowReplacementPayload): RowEdit {
    switch (input.rowKind) {
        case 'note':
            return { kind: 'note', expected: input.expected, replacement: input.replacement };
        case 'cc':
            return { kind: 'cc', expected: input.expected, replacement: input.replacement };
        case 'bend':
            return { kind: 'bend', expected: input.expected, replacement: input.replacement };
    }
}

function containsRow(source: MidiTakeSource, edit: RowEdit): boolean {
    const slot =
        edit.kind === 'note'
            ? source.rows.notes
            : edit.kind === 'cc'
              ? source.rows.controlChanges
              : source.rows.pitchBends;
    return slot.value.some((row) => row.id === edit.expected.id);
}

/** Prepare every frozen copy before one write; a stale copy refuses the entire action. */
export function prepareOriginalMidiTakeRowReplacement(
    input: OriginalMidiTakeRowReplacementPayload,
    state: TakeLaneStoreState | null
): TakeLaneStoreState | null {
    const owner = state?.lanes.find((lane) => lane.id === input.laneId)?.takes.find((take) => take.id === input.takeId);
    const ownerSource = owner?.midiSource;
    const edit = rowEdit(input);
    if (
        !state ||
        !input.sourceClipId ||
        !input.rowId ||
        input.rowId !== edit.expected.id ||
        input.rowId !== edit.replacement.id ||
        ownerSource?.sourceClipId !== input.sourceClipId ||
        !ownerSource ||
        !containsRow(ownerSource, edit)
    ) {
        return null;
    }
    let changed = 0;
    let refused = false;
    const lanes = state.lanes.map((lane) => ({
        ...lane,
        takes: lane.takes.map((take) => {
            const source = take.midiSource;
            if (!source || source.sourceClipId !== input.sourceClipId || !containsRow(source, edit)) {
                return take;
            }
            const replacement = replaceFrozenMidiTakeRow(source, edit);
            if (!replacement) {
                refused = true;
                return take;
            }
            changed += 1;
            return { ...take, midiSource: replacement };
        }),
    }));
    return refused || changed === 0 ? null : { lanes };
}

/** One original row is shared by the frozen selected and unselected fragments of its source clip. */
export function replaceOriginalMidiTakeRow(input: OriginalMidiTakeRowReplacementPayload): void {
    const next = prepareOriginalMidiTakeRowReplacement(input, takeLaneStore.value);
    if (!next) {
        throw new Error('Frozen MIDI take row changed or owner is unavailable');
    }
    takeLaneStore.set(next);
}
