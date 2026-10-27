import { replaceFrozenMidiTakeRow } from '#/modules/MIDI/useCases';

import { type MidiTakeSource } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

type RowEdit = Parameters<typeof replaceFrozenMidiTakeRow>[1];
type OriginalMidiTakeRowEdit = {
    readonly laneId: string;
    readonly takeId: string;
    /** Immutable capture owner shared by split fragments and other takes. */
    readonly sourceClipId: string;
    readonly rowId: string;
    readonly edit: RowEdit;
};

function containsRow(source: MidiTakeSource, edit: RowEdit): boolean {
    const slot =
        edit.kind === 'note'
            ? source.rows.notes
            : edit.kind === 'cc'
              ? source.rows.controlChanges
              : source.rows.pitchBends;
    return slot.value.some((row) => row.id === edit.expected.id);
}

/** One original row is shared by the frozen selected and unselected fragments of its source clip. */
export function replaceOriginalMidiTakeRow(input: OriginalMidiTakeRowEdit): void {
    const state = takeLaneStore.value;
    const owner = state?.lanes.find((lane) => lane.id === input.laneId)?.takes.find((take) => take.id === input.takeId);
    const ownerSource = owner?.midiSource;
    if (
        !state ||
        !input.sourceClipId ||
        !input.rowId ||
        input.rowId !== input.edit.expected.id ||
        input.rowId !== input.edit.replacement.id ||
        ownerSource?.sourceClipId !== input.sourceClipId ||
        !ownerSource ||
        !containsRow(ownerSource, input.edit)
    ) {
        throw new Error('Frozen MIDI take row owner is unavailable');
    }
    let changed = 0;
    const lanes = state.lanes.map((lane) => ({
        ...lane,
        takes: lane.takes.map((take) => {
            const source = take.midiSource;
            if (!source || source.sourceClipId !== input.sourceClipId || !containsRow(source, input.edit)) {
                return take;
            }
            const replacement = replaceFrozenMidiTakeRow(source, input.edit);
            if (!replacement) {
                throw new Error('Frozen MIDI take row changed');
            }
            changed += 1;
            return { ...take, midiSource: replacement };
        }),
    }));
    if (changed === 0) {
        throw new Error('Frozen MIDI take row owner is unavailable');
    }
    takeLaneStore.set({ lanes });
}
