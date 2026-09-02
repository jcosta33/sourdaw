import { validateVersionedCommandArguments } from './versionedCommandArgumentKeys';

import type { SessionActionContract } from '../stores/undoSessionMirror';

const INTERNAL_UNDO_SESSION_REPLAY_OPERATION_VERSIONS = {
    discardCreatedTrack: 1,
    discardDuplicatedClip: 1,
    restoreMidiClipNotes: 1,
} as const;

/**
 * Internal inverse actions are replayable session state, not provider operations.
 * Keep their versioned contracts separate from executable discovery while injecting
 * them into the store-owned session mirror at production registration time.
 */
export function getInternalUndoSessionReplayContracts(): readonly SessionActionContract[] {
    return Object.entries(INTERNAL_UNDO_SESSION_REPLAY_OPERATION_VERSIONS).map(([actionType, operationVersion]) => ({
        actionType,
        operationVersion,
        role: 'internal-replay',
        validateArguments: (payload: unknown) => validateVersionedCommandArguments(actionType, payload),
    }));
}
