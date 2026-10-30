import { replaceFrozenMidiTakeRow } from '#/modules/MIDI/useCases';
import { type OriginalMidiTakeRowCopy, type OriginalMidiTakeRowReplacementPayload } from '#/utils/handlerContract';

import { type MidiTakeSource } from '../../models/TakeLane';
import { type TakeLaneStoreState } from '../../stores/takeLaneStore';

type RowEdit = Parameters<typeof replaceFrozenMidiTakeRow>[1];

function rowEdit(input: OriginalMidiTakeRowReplacementPayload): RowEdit {
    switch (input.rowKind) {
        case 'note':
            return {
                kind: 'note',
                expected: input.expected,
                replacement: input.replacement,
                expectedSlotPresent: input.expectedSlotPresent,
                replacementSlotPresent: input.replacementSlotPresent,
            };
        case 'cc':
            return {
                kind: 'cc',
                expected: input.expected,
                replacement: input.replacement,
                expectedSlotPresent: input.expectedSlotPresent,
                replacementSlotPresent: input.replacementSlotPresent,
            };
        case 'bend':
            return {
                kind: 'bend',
                expected: input.expected,
                replacement: input.replacement,
                expectedSlotPresent: input.expectedSlotPresent,
                replacementSlotPresent: input.replacementSlotPresent,
            };
    }
    throw new Error('Unsupported frozen MIDI row kind');
}

function containsRow(source: MidiTakeSource, edit: RowEdit, rowId: string): boolean {
    switch (edit.kind) {
        case 'note':
            return source.rows.notes.value.some((row) => row.id === rowId);
        case 'cc':
            return source.rows.controlChanges.value.some((row) => row.id === rowId);
        case 'bend':
            return source.rows.pitchBends.value.some((row) => row.id === rowId);
    }
    throw new Error('Unsupported frozen MIDI row kind');
}

function notePassIdentityMatches(
    input: OriginalMidiTakeRowReplacementPayload,
    takePassIndex: number | undefined
): boolean {
    if (input.rowKind !== 'note') {
        return true;
    }
    const { expected, replacement } = input;
    if (
        expected &&
        replacement &&
        (Object.hasOwn(expected, 'recordingPassIndex') !== Object.hasOwn(replacement, 'recordingPassIndex') ||
            expected.recordingPassIndex !== replacement.recordingPassIndex)
    ) {
        return false;
    }
    if (expected) {
        return (
            !Object.hasOwn(expected, 'recordingPassIndex') ||
            (typeof expected.recordingPassIndex === 'number' &&
                Number.isSafeInteger(expected.recordingPassIndex) &&
                expected.recordingPassIndex >= 0)
        );
    }
    if (!replacement) {
        return false;
    }
    if (isWitnessedMidiCopyScope(input.copyScope)) {
        // A delete inverse restores the original row identity, including legacy
        // absence or another pass held in this shared frozen source.
        return (
            !Object.hasOwn(replacement, 'recordingPassIndex') ||
            (typeof replacement.recordingPassIndex === 'number' &&
                Number.isSafeInteger(replacement.recordingPassIndex) &&
                replacement.recordingPassIndex >= 0)
        );
    }
    return (
        replacement.recordingPassIndex === takePassIndex &&
        Object.hasOwn(replacement, 'recordingPassIndex') === (takePassIndex !== undefined)
    );
}

function ownerAcceptsEdit(
    input: OriginalMidiTakeRowReplacementPayload,
    edit: RowEdit,
    ownerSource: MidiTakeSource | undefined,
    takePassIndex: number | undefined
): boolean {
    if (
        !input.sourceClipId ||
        !input.rowId ||
        (edit.expected === null && edit.replacement === null) ||
        (edit.expected !== null && input.rowId !== edit.expected.id) ||
        (edit.replacement !== null && input.rowId !== edit.replacement.id) ||
        !ownerSource ||
        ownerSource.sourceClipId !== input.sourceClipId ||
        !notePassIdentityMatches(input, takePassIndex)
    ) {
        return false;
    }
    const ownerHasRow = containsRow(ownerSource, edit, input.rowId);
    return (edit.expected === null && !ownerHasRow) || (edit.expected !== null && ownerHasRow);
}

function rowSlot(source: MidiTakeSource, kind: RowEdit['kind']) {
    switch (kind) {
        case 'note':
            return source.rows.notes;
        case 'cc':
            return source.rows.controlChanges;
        case 'bend':
            return source.rows.pitchBends;
    }
    throw new Error('Unsupported frozen MIDI row kind');
}

function hasValidRecordingPass(copy: { readonly recordingPassIndex?: number }): boolean {
    return (
        !Object.hasOwn(copy, 'recordingPassIndex') ||
        (typeof copy.recordingPassIndex === 'number' &&
            Number.isSafeInteger(copy.recordingPassIndex) &&
            copy.recordingPassIndex >= 0)
    );
}

function isWitnessedMidiCopyScope(
    scope: OriginalMidiTakeRowReplacementPayload['copyScope']
): scope is readonly OriginalMidiTakeRowCopy[] {
    return (
        Array.isArray(scope) &&
        scope.length > 0 &&
        scope.every(
            (copy: OriginalMidiTakeRowCopy) =>
                copy !== null &&
                typeof copy === 'object' &&
                typeof copy.laneId === 'string' &&
                copy.laneId.length > 0 &&
                typeof copy.takeId === 'string' &&
                copy.takeId.length > 0 &&
                typeof copy.clipId === 'string' &&
                copy.clipId.length > 0 &&
                Number.isFinite(copy.sourceEntryBeat) &&
                Number.isFinite(copy.sourceEndBeat) &&
                Number.isFinite(copy.passLengthBeats) &&
                copy.passLengthBeats > 0 &&
                typeof copy.expectedSlotPresent === 'boolean' &&
                typeof copy.replacementSlotPresent === 'boolean' &&
                (copy.expectedNextRowId === null || typeof copy.expectedNextRowId === 'string') &&
                (copy.replacementNextRowId === null || typeof copy.replacementNextRowId === 'string') &&
                hasValidRecordingPass(copy)
        )
    );
}

function matchesCapturedSource(
    source: MidiTakeSource,
    input: OriginalMidiTakeRowReplacementPayload,
    edit: RowEdit
): boolean {
    return (
        source.sourceClipId === input.sourceClipId && (edit.expected === null || containsRow(source, edit, input.rowId))
    );
}

function copyWithRecordingPass(
    copy: OriginalMidiTakeRowCopy,
    take: { readonly recordingPassIndex?: number }
): OriginalMidiTakeRowCopy | null {
    if (!Object.hasOwn(take, 'recordingPassIndex')) {
        return copy;
    }
    if (!hasValidRecordingPass(take) || take.recordingPassIndex === undefined) {
        return null;
    }
    return { ...copy, recordingPassIndex: take.recordingPassIndex };
}

/** Capture only copies this forward edit changes, before any dispatch wait. */
function captureOriginalMidiTakeRowCopies(
    input: OriginalMidiTakeRowReplacementPayload,
    state: TakeLaneStoreState | null
): readonly OriginalMidiTakeRowCopy[] | null {
    const owner = state?.lanes.find((lane) => lane.id === input.laneId)?.takes.find((take) => take.id === input.takeId);
    const edit = rowEdit(input);
    if (
        !state ||
        !ownerAcceptsEdit(input, edit, owner?.midiSource, owner?.recordingPassIndex) ||
        !owner?.midiSource ||
        rowSlot(owner.midiSource, edit.kind).present !== input.expectedSlotPresent
    ) {
        return null;
    }
    const copies: OriginalMidiTakeRowCopy[] = [];
    for (const lane of state.lanes) {
        for (const take of lane.takes) {
            const source = take.midiSource;
            if (!source || !matchesCapturedSource(source, input, edit)) {
                continue;
            }
            const slot = rowSlot(source, edit.kind);
            const index = slot.value.findIndex((row) => row.id === input.rowId);
            const nextRowId = index < 0 ? null : (slot.value[index + 1]?.id ?? null);
            const copy: OriginalMidiTakeRowCopy = {
                laneId: lane.id,
                takeId: take.id,
                clipId: take.clipId,
                sourceEntryBeat: source.sourceEntryBeat,
                sourceEndBeat: source.sourceEndBeat,
                passLengthBeats: source.passLengthBeats,
                expectedSlotPresent: slot.present,
                replacementSlotPresent: input.replacementSlotPresent,
                expectedNextRowId: nextRowId,
                replacementNextRowId: edit.replacement === null ? null : nextRowId,
            };
            const witnessed = copyWithRecordingPass(copy, take);
            if (!witnessed) {
                return null;
            }
            copies.push(witnessed);
        }
    }
    return isWitnessedMidiCopyScope(copies) ? copies : null;
}

function copyKey(copy: Pick<OriginalMidiTakeRowCopy, 'laneId' | 'takeId'>): string {
    return JSON.stringify([copy.laneId, copy.takeId]);
}

/** Prepare the admitted copies atomically; new and untouched copies have no replay authority. */
function prepareOriginalMidiTakeRowReplacement(
    input: OriginalMidiTakeRowReplacementPayload,
    state: TakeLaneStoreState | null
): TakeLaneStoreState | null {
    const scope = input.copyScope;
    const owner = state?.lanes.find((lane) => lane.id === input.laneId)?.takes.find((take) => take.id === input.takeId);
    const edit = rowEdit(input);
    if (
        !state ||
        !isWitnessedMidiCopyScope(scope) ||
        !ownerAcceptsEdit(input, edit, owner?.midiSource, owner?.recordingPassIndex)
    ) {
        return null;
    }
    const copies = new Map(scope.map((copy) => [copyKey(copy), copy]));
    if (copies.size !== scope.length || !copies.has(copyKey(input))) {
        return null;
    }
    let changed = 0;
    let refused = false;
    const lanes = state.lanes.map((lane) => ({
        ...lane,
        takes: lane.takes.map((take) => {
            const copy = copies.get(copyKey({ laneId: lane.id, takeId: take.id }));
            if (!copy) {
                return take;
            }
            const source = take.midiSource;
            if (
                !source ||
                source.sourceClipId !== input.sourceClipId ||
                take.clipId !== copy.clipId ||
                source.sourceEntryBeat !== copy.sourceEntryBeat ||
                source.sourceEndBeat !== copy.sourceEndBeat ||
                source.passLengthBeats !== copy.passLengthBeats ||
                Object.hasOwn(take, 'recordingPassIndex') !== Object.hasOwn(copy, 'recordingPassIndex') ||
                take.recordingPassIndex !== copy.recordingPassIndex
            ) {
                refused = true;
                return take;
            }
            const slot = rowSlot(source, edit.kind);
            const index = slot.value.findIndex((row) => row.id === input.rowId);
            if (
                edit.expected !== null &&
                (index < 0 || (slot.value[index + 1]?.id ?? null) !== copy.expectedNextRowId)
            ) {
                refused = true;
                return take;
            }
            const replacement = replaceFrozenMidiTakeRow(source, {
                ...edit,
                expectedSlotPresent: copy.expectedSlotPresent,
                replacementSlotPresent: copy.replacementSlotPresent,
                replacementNextRowId: copy.replacementNextRowId,
            });
            if (!replacement) {
                refused = true;
                return take;
            }
            changed += 1;
            return { ...take, midiSource: replacement };
        }),
    }));
    return refused || changed !== copies.size ? null : { lanes };
}

export const originalMidiTakeRowReplacement = {
    isWitnessedMidiCopyScope,
    captureOriginalMidiTakeRowCopies,
    prepareOriginalMidiTakeRowReplacement,
};
