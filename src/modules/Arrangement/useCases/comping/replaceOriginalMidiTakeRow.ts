import { type OriginalMidiTakeRowReplacementPayload } from '#/utils/handlerContract';

import { takeLaneStore } from '../../stores/takeLaneStore';

import {
    captureOriginalMidiTakeRowCopies,
    prepareOriginalMidiTakeRowReplacement,
} from './prepareOriginalMidiTakeRowReplacement';

/** One original row is shared by the frozen selected and unselected fragments of its source clip. */
export function replaceOriginalMidiTakeRow(input: OriginalMidiTakeRowReplacementPayload): void {
    const copyScope =
        input.copyScope === undefined || input.copyScope === 'capture'
            ? captureOriginalMidiTakeRowCopies(input, takeLaneStore.value)
            : input.copyScope;
    const next = copyScope && prepareOriginalMidiTakeRowReplacement({ ...input, copyScope }, takeLaneStore.value);
    if (!next) {
        throw new Error('Frozen MIDI take row changed or owner is unavailable');
    }
    takeLaneStore.set(next);
}
