import { getHandlerByType } from '../stores/handlerRegistry';

import { validateVersionedCommandArguments } from './versionedCommandArgumentKeys';

import type { SessionActionContract } from '../stores/undoSessionMirror';

function createInternalReplayContract(
    actionType:
        | 'discardCreatedTrack'
        | 'discardDuplicatedClip'
        | 'discardDrawnClip'
        | 'restoreClipMoves'
        | 'restoreClip'
        | 'restoreClipPlacement'
        | 'restoreClipSplitState'
        | 'restoreDrawnClip'
        | 'restoreMidiClipNotes'
        | 'restoreAutomationPointPresence'
        | 'restoreTimeOperationState',
    operationVersion: number,
    ownerValidation: 'optional' | 'required'
): SessionActionContract {
    return {
        actionType,
        operationVersion,
        role: 'internal-replay',
        validateArguments: (payload: unknown) => {
            const ownerValidator = getHandlerByType(actionType)?.validateSessionActionArguments;
            // These internal actions carry owner-defined captures wider than
            // their neutral Command snapshots. Their owner validators decode
            // the complete shapes without widening executable discovery.
            if (actionType === 'restoreClip' || actionType === 'restoreTimeOperationState') {
                return ownerValidator?.(payload) === true;
            }
            if (!validateVersionedCommandArguments(actionType, payload)) {
                return false;
            }
            return ownerValidation === 'optional'
                ? (ownerValidator?.(payload) ?? true)
                : ownerValidator?.(payload) === true;
        },
    };
}

/**
 * Local actions and internal inverse actions are replayable session state, not
 * provider operations. Keep these contracts separate from executable discovery
 * while injecting them into the store-owned mirror at production registration.
 */
export function getInternalUndoSessionReplayContracts(): readonly SessionActionContract[] {
    return [
        {
            actionType: 'insertTime',
            operationVersion: 1,
            role: 'forward',
            validateArguments: (payload: unknown) => validateVersionedCommandArguments('insertTime', payload),
            validateEntry: (entry) => getHandlerByType('insertTime')?.validateSessionEntry?.(entry) === true,
        },
        {
            actionType: 'duplicateTimeRange',
            operationVersion: 1,
            role: 'forward',
            validateArguments: (payload: unknown) => validateVersionedCommandArguments('duplicateTimeRange', payload),
            validateEntry: (entry) => getHandlerByType('duplicateTimeRange')?.validateSessionEntry?.(entry) === true,
        },
        {
            actionType: 'deleteTime',
            operationVersion: 1,
            role: 'forward',
            validateArguments: (payload: unknown) => validateVersionedCommandArguments('deleteTime', payload),
            validateEntry: (entry) => getHandlerByType('deleteTime')?.validateSessionEntry?.(entry) === true,
        },
        createInternalReplayContract('discardCreatedTrack', 1, 'optional'),
        createInternalReplayContract('discardDuplicatedClip', 1, 'optional'),
        createInternalReplayContract('discardDrawnClip', 1, 'optional'),
        createInternalReplayContract('restoreClipMoves', 1, 'optional'),
        createInternalReplayContract('restoreClip', 1, 'required'),
        createInternalReplayContract('restoreClipPlacement', 1, 'required'),
        createInternalReplayContract('restoreClipSplitState', 1, 'required'),
        createInternalReplayContract('restoreDrawnClip', 1, 'optional'),
        createInternalReplayContract('restoreMidiClipNotes', 1, 'required'),
        createInternalReplayContract('restoreAutomationPointPresence', 1, 'required'),
        createInternalReplayContract('restoreTimeOperationState', 1, 'required'),
    ];
}
