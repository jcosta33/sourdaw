import { getTransportState } from '#/modules/Transport/useCases';
import { createHandler } from '#/utils/createHandler';

import { setClipLoopLength } from '../../useCases/clipLoop/setClipLoopLength';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { findClipForLoopLength, isSafeRequestedClipLoopLength, readClipLoopLengthState } from './clipLoopLengthState';

function transportIsBusy(): boolean {
    const transport = getTransportState();
    return transport?.isPlaying === true || transport?.isRecording === true;
}

export const handleSetClipLoopLength = createHandler<'setClipLoopLength'>({
    execute: (action) => {
        const clip = findClipForLoopLength(action.payload.clipId);
        if (
            transportIsBusy() ||
            !clip ||
            clip.locked ||
            !isSafeRequestedClipLoopLength(clip, action.payload.loopLength)
        ) {
            return { status: 'conflict' };
        }
        return toHandlerExecutionResult(setClipLoopLength(action.payload.clipId, action.payload.loopLength));
    },
    describe: (action) => {
        const clip = findClipForLoopLength(action.payload.clipId);
        const previous = clip ? readClipLoopLengthState(clip) : null;
        const next = { present: true, value: action.payload.loopLength };
        return {
            label: `Set clip loop length to ${String(action.payload.loopLength)} beats`,
            inverseAction: previous
                ? {
                      type: 'restoreClipLoopLength',
                      payload: { clipId: action.payload.clipId, expected: next, replacement: previous },
                  }
                : null,
            redoAction: previous
                ? {
                      type: 'restoreClipLoopLength',
                      payload: { clipId: action.payload.clipId, expected: previous, replacement: next },
                  }
                : action,
        };
    },
    isNoop: (action) => {
        if (transportIsBusy()) {
            return false;
        }
        const clip = findClipForLoopLength(action.payload.clipId);
        if (!clip || clip.locked || !isSafeRequestedClipLoopLength(clip, action.payload.loopLength)) {
            return false;
        }
        const current = readClipLoopLengthState(clip);
        return current.present && current.value === action.payload.loopLength;
    },
    undoable: true,
});
