import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { restoreClipLoopLength } from '../../useCases/clipLoop/restoreClipLoopLength';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import {
    clipLoopLengthStatesMatch,
    findClipForLoopLength,
    isSafeRequestedClipLoopLength,
    readClipLoopLengthState,
    transportIsBusy,
} from './clipLoopLengthState';

type RestoreClipLoopLengthAction = Extract<AppAction, { type: 'restoreClipLoopLength' }>;

type LoopLengthRestoreGuard = { ok: true; alreadyApplied: boolean } | { ok: false };

/** Same precondition `execute` writes against — transport idle, clip present and unlocked,
 *  state matches either the guarded `expected` or is already the `replacement` (no-op), and a
 *  present replacement stays within the shared loop-iteration bound. `validate` reuses this so a
 *  batch preflight refuses a diverged clip instead of executing into a silent overwrite. */
function loopLengthRestoreGuard(action: RestoreClipLoopLengthAction): LoopLengthRestoreGuard {
    if (transportIsBusy()) {
        return { ok: false };
    }
    const clip = findClipForLoopLength(action.payload.clipId);
    if (!clip || clip.locked) {
        return { ok: false };
    }
    const replacement = action.payload.replacement;
    const current = readClipLoopLengthState(clip);
    if (clipLoopLengthStatesMatch(current, replacement)) {
        return { ok: true, alreadyApplied: true };
    }
    if (!clipLoopLengthStatesMatch(current, action.payload.expected)) {
        return { ok: false };
    }
    if (replacement.present && !isSafeRequestedClipLoopLength(clip, replacement.value)) {
        return { ok: false };
    }
    return { ok: true, alreadyApplied: false };
}

export const handleRestoreClipLoopLength = createHandler<'restoreClipLoopLength'>({
    batchExecution: 'singleton',
    // `expected` is mandatory on this payload, so every instance carries a real precondition
    // `validate` re-checks.
    canReapplyAfterDivergence: () => true,
    validate: (action) => loopLengthRestoreGuard(action).ok,
    execute: (action) => {
        const guard = loopLengthRestoreGuard(action);
        if (!guard.ok) {
            return { status: 'conflict' };
        }
        if (guard.alreadyApplied) {
            return { status: 'no-write' };
        }
        const replacement = action.payload.replacement;
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
