import { getHandlerByType } from '../stores/handlerRegistry';

import { validateVersionedCommandArguments } from './versionedCommandArgumentKeys';

import type { SessionActionContract } from '../stores/undoSessionMirror';

function createInternalReplayContract(
    actionType:
        | 'discardRecording'
        | 'restoreRecording'
        | 'discardCreatedTrack'
        | 'discardDuplicatedClip'
        | 'discardDrawnClip'
        | 'restoreClipMoves'
        | 'restoreClip'
        | 'restoreClipPlacement'
        | 'restoreClipSplitState'
        | 'restoreStripSilenceState'
        | 'restoreAudioClipStartTrim'
        | 'restoreAudioClipSlip'
        | 'restoreDrawnClip'
        | 'restoreMidiClipNotes'
        | 'restoreAutomationPointPresence'
        | 'removeTrackGainAutomationRange'
        | 'removeSendAutomationRange'
        | 'removeSendAutomationRanges'
        | 'removeAutomationLane'
        | 'restoreAutomationLanePoints'
        | 'restoreTimeOperationState'
        | 'restoreCompRegionInterval'
        | 'restoreTempoEdit'
        | 'restoreTempoMapEdit',
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
            if (
                actionType === 'restoreRecording' ||
                actionType === 'restoreClip' ||
                actionType === 'restoreTimeOperationState' ||
                actionType === 'restoreAudioClipStartTrim' ||
                actionType === 'restoreAudioClipSlip'
            ) {
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
            actionType: 'commitRecording',
            operationVersion: 1,
            role: 'forward',
            validateArguments: (payload: unknown) => validateVersionedCommandArguments('commitRecording', payload),
            validateEntry: (entry) => getHandlerByType('commitRecording')?.validateSessionEntry?.(entry) === true,
        },
        createInternalReplayContract('discardRecording', 1, 'optional'),
        createInternalReplayContract('restoreRecording', 1, 'required'),
        {
            actionType: 'editTempoMap',
            operationVersion: 1,
            role: 'forward',
            validateArguments: (payload: unknown) => validateVersionedCommandArguments('editTempoMap', payload),
            validateEntry: (entry) => getHandlerByType('editTempoMap')?.validateSessionEntry?.(entry) === true,
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
        createInternalReplayContract('restoreStripSilenceState', 1, 'required'),
        createInternalReplayContract('restoreAudioClipStartTrim', 1, 'required'),
        createInternalReplayContract('restoreAudioClipSlip', 1, 'required'),
        createInternalReplayContract('restoreDrawnClip', 1, 'optional'),
        createInternalReplayContract('restoreMidiClipNotes', 1, 'required'),
        createInternalReplayContract('restoreAutomationPointPresence', 1, 'required'),
        createInternalReplayContract('removeTrackGainAutomationRange', 1, 'required'),
        createInternalReplayContract('removeSendAutomationRange', 1, 'required'),
        createInternalReplayContract('removeSendAutomationRanges', 1, 'required'),
        createInternalReplayContract('removeAutomationLane', 1, 'required'),
        createInternalReplayContract('restoreAutomationLanePoints', 1, 'required'),
        createInternalReplayContract('restoreTimeOperationState', 1, 'required'),
        createInternalReplayContract('restoreCompRegionInterval', 1, 'required'),
        createInternalReplayContract('restoreTempoEdit', 1, 'required'),
        createInternalReplayContract('restoreTempoMapEdit', 1, 'required'),
    ];
}
