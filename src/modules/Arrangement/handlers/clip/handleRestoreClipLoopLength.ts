import { getTransportState } from '#/modules/Transport/useCases';
import { createHandler } from '#/utils/createHandler';

import { restoreClipLoopLength } from '../../useCases/clipLoop/restoreClipLoopLength';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import {
    clipLoopLengthStatesMatch,
    findClipForLoopLength,
    isSafeRequestedClipLoopLength,
    readClipLoopLengthState,
} from './clipLoopLengthState';

function transportIsBusy(): boolean {
    const transport = getTransportState();
    return transport?.isPlaying === true || transport?.isRecording === true;
}

export const handleRestoreClipLoopLength = createHandler<'restoreClipLoopLength'>({
    execute: (action) => {
        const clip = findClipForLoopLength(action.payload.clipId);
        if (transportIsBusy() || !clip || clip.locked) {
            return { status: 'conflict' };
        }
        const replacement = action.payload.replacement;
        const current = readClipLoopLengthState(clip);
        if (clipLoopLengthStatesMatch(current, replacement)) {
            return { status: 'no-write' };
        }
        if (!clipLoopLengthStatesMatch(current, action.payload.expected)) {
            return { status: 'conflict' };
        }
        if (replacement.present && !isSafeRequestedClipLoopLength(clip, replacement.value)) {
            return { status: 'conflict' };
        }
        return toHandlerExecutionResult(
            restoreClipLoopLength(action.payload.clipId, replacement.present ? replacement.value : undefined)
        );
    },
    describe: () => ({ label: 'Restore clip loop length', inverseAction: null }),
    isNoop: (action) => {
        if (transportIsBusy()) {
            return false;
        }
        const clip = findClipForLoopLength(action.payload.clipId);
        return clip ? clipLoopLengthStatesMatch(readClipLoopLengthState(clip), action.payload.replacement) : false;
    },
    undoable: false,
});
