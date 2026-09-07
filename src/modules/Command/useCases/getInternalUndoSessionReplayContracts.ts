import { getHandlerByType } from '../stores/handlerRegistry';

import { validateVersionedCommandArguments } from './versionedCommandArgumentKeys';

import type { SessionActionContract } from '../stores/undoSessionMirror';

function createInternalReplayContract(
    actionType:
        | 'discardCreatedTrack'
        | 'discardDuplicatedClip'
        | 'discardDrawnClip'
        | 'restoreClipMoves'
        | 'restoreDrawnClip'
        | 'restoreMidiClipNotes',
    operationVersion: number,
    ownerValidation: 'optional' | 'required'
): SessionActionContract {
    return {
        actionType,
        operationVersion,
        role: 'internal-replay',
        validateArguments: (payload: unknown) => {
            if (!validateVersionedCommandArguments(actionType, payload)) {
                return false;
            }
            const ownerValidator = getHandlerByType(actionType)?.validateSessionActionArguments;
            return ownerValidation === 'optional'
                ? (ownerValidator?.(payload) ?? true)
                : ownerValidator?.(payload) === true;
        },
    };
}

/**
 * Internal inverse actions are replayable session state, not provider operations.
 * Keep their versioned contracts separate from executable discovery while injecting
 * them into the store-owned session mirror at production registration time.
 */
export function getInternalUndoSessionReplayContracts(): readonly SessionActionContract[] {
    return [
        createInternalReplayContract('discardCreatedTrack', 1, 'optional'),
        createInternalReplayContract('discardDuplicatedClip', 1, 'optional'),
        createInternalReplayContract('discardDrawnClip', 1, 'optional'),
        createInternalReplayContract('restoreClipMoves', 1, 'optional'),
        createInternalReplayContract('restoreDrawnClip', 1, 'optional'),
        createInternalReplayContract('restoreMidiClipNotes', 1, 'required'),
    ];
}
