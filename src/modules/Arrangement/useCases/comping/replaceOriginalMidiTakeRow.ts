import { type OriginalMidiTakeRowReplacementPayload } from '#/utils/handlerContract';

import { takeLaneStore } from '../../stores/takeLaneStore';

import { prepareOriginalMidiTakeRowReplacement } from './prepareOriginalMidiTakeRowReplacement';

/** One original row is shared by the frozen selected and unselected fragments of its source clip. */
export function replaceOriginalMidiTakeRow(input: OriginalMidiTakeRowReplacementPayload): void {
    const next = prepareOriginalMidiTakeRowReplacement(input, takeLaneStore.value);
    if (!next) {
        throw new Error('Frozen MIDI take row changed or owner is unavailable');
    }
    takeLaneStore.set(next);
}
