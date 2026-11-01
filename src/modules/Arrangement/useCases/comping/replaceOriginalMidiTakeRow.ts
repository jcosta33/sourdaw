import { type OriginalMidiTakeRowReplacementPayload } from '#/utils/handlerContract';

import { takeLaneStore } from '../../stores/takeLaneStore';

import { originalMidiTakeRowReplacement } from './prepareOriginalMidiTakeRowReplacement';

const { captureOriginalMidiTakeRowCopies, prepareOriginalMidiTakeRowReplacement } = originalMidiTakeRowReplacement;

/** One original row is shared by the frozen selected and unselected fragments of its source clip. */
export function replaceOriginalMidiTakeRow(input: OriginalMidiTakeRowReplacementPayload): void {
    let copyScope: typeof input.copyScope | null = input.copyScope;
    if (copyScope === undefined || copyScope === 'capture') {
        copyScope = captureOriginalMidiTakeRowCopies(input, takeLaneStore.value);
    }
    const next = copyScope && prepareOriginalMidiTakeRowReplacement({ ...input, copyScope }, takeLaneStore.value);
    if (!next) {
        throw new Error('Frozen MIDI take row changed or owner is unavailable');
    }
    takeLaneStore.set(next);
}
