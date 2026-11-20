import {
    type InternalReplayActionType,
    internalReplayOwnerValidationByActionType,
} from '../models/InternalReplayOwnerValidation';
import { getHandlerByType } from '../stores/handlerRegistry';

import { validateVersionedCommandArguments } from './versionedCommandArgumentKeys';

import type { SessionActionContract } from '../stores/undoSessionMirror';

function createInternalReplayContract(actionType: InternalReplayActionType): SessionActionContract {
    const ownerValidation = internalReplayOwnerValidationByActionType[actionType];
    return {
        actionType,
        operationVersion: 1,
        role: 'internal-replay',
        validateArguments: (payload: unknown) => {
            const ownerValidator = getHandlerByType(actionType)?.validateSessionActionArguments;
            // These internal actions carry owner-defined captures wider than
            // their neutral Command snapshots. Their owner validators decode
            // the complete shapes without widening executable discovery.
            if (ownerValidation === 'owner-only') {
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

const toasterFactoryKitReplayContract: SessionActionContract = {
    actionType: 'setToasterFactoryKit',
    operationVersion: 1,
    role: 'forward',
    validateArguments: (payload: unknown) =>
        validateVersionedCommandArguments('setToasterFactoryKit', payload) &&
        getHandlerByType('setToasterFactoryKit')?.validateSessionActionArguments?.(payload) === true,
    validateEntry: (entry) => getHandlerByType('setToasterFactoryKit')?.validateSessionEntry?.(entry) === true,
};

const glutenFactoryPresetReplayContract: SessionActionContract = {
    actionType: 'setGlutenFactoryPreset',
    operationVersion: 1,
    role: 'forward',
    validateArguments: (payload: unknown) =>
        validateVersionedCommandArguments('setGlutenFactoryPreset', payload) &&
        getHandlerByType('setGlutenFactoryPreset')?.validateSessionActionArguments?.(payload) === true,
    validateEntry: (entry) => getHandlerByType('setGlutenFactoryPreset')?.validateSessionEntry?.(entry) === true,
};

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
        {
            actionType: 'insertAutomationLanePoints',
            operationVersion: 1,
            role: 'forward',
            validateArguments: (payload: unknown) =>
                validateVersionedCommandArguments('insertAutomationLanePoints', payload) &&
                getHandlerByType('insertAutomationLanePoints')?.validateSessionActionArguments?.(payload) === true,
            validateEntry: (entry) =>
                getHandlerByType('insertAutomationLanePoints')?.validateSessionEntry?.(entry) === true,
            restoreEntry: (entry) => getHandlerByType('insertAutomationLanePoints')?.restoreSessionEntry?.(entry),
        },
        toasterFactoryKitReplayContract,
        glutenFactoryPresetReplayContract,
        createInternalReplayContract('discardRecording'),
        createInternalReplayContract('restoreRecording'),
        {
            actionType: 'editTempoMap',
            operationVersion: 1,
            role: 'forward',
            validateArguments: (payload: unknown) => validateVersionedCommandArguments('editTempoMap', payload),
            validateEntry: (entry) => getHandlerByType('editTempoMap')?.validateSessionEntry?.(entry) === true,
        },
        {
            actionType: 'relinkClipAudioSources',
            operationVersion: 1,
            role: 'forward',
            validateArguments: (payload: unknown) =>
                validateVersionedCommandArguments('relinkClipAudioSources', payload),
            validateEntry: (entry) =>
                [entry.action, entry.inverseAction, entry.redoAction].every(
                    (action) =>
                        action?.type === 'relinkClipAudioSources' &&
                        validateVersionedCommandArguments('relinkClipAudioSources', action.payload)
                ) && getHandlerByType('relinkClipAudioSources')?.validateSessionEntry?.(entry) === true,
        },
        {
            actionType: 'deleteTime',
            operationVersion: 1,
            role: 'forward',
            validateArguments: (payload: unknown) => validateVersionedCommandArguments('deleteTime', payload),
            validateEntry: (entry) => getHandlerByType('deleteTime')?.validateSessionEntry?.(entry) === true,
        },
        createInternalReplayContract('discardCreatedTrack'),
        createInternalReplayContract('discardDuplicatedClip'),
        createInternalReplayContract('discardDrawnClip'),
        createInternalReplayContract('restoreClipMoves'),
        createInternalReplayContract('restoreClip'),
        createInternalReplayContract('restoreClipPlacement'),
        createInternalReplayContract('restoreClipSplitState'),
        createInternalReplayContract('restoreStripSilenceState'),
        createInternalReplayContract('restoreAudioClipStartTrim'),
        createInternalReplayContract('restoreAudioClipSlip'),
        createInternalReplayContract('restoreDrawnClip'),
        createInternalReplayContract('restoreMidiClipNotes'),
        createInternalReplayContract('restoreAutomationPointPresence'),
        createInternalReplayContract('removeTrackGainAutomationRange'),
        createInternalReplayContract('removeSendAutomationRange'),
        createInternalReplayContract('removeSendAutomationRanges'),
        createInternalReplayContract('removeAutomationLane'),
        createInternalReplayContract('restoreAutomationLanePoints'),
        createInternalReplayContract('restoreTimeOperationState'),
        createInternalReplayContract('restoreCompRegionInterval'),
        createInternalReplayContract('restoreTempoEdit'),
        createInternalReplayContract('restoreTempoMapEdit'),
        // The guarded inverse of extractGroove; the extraction's own entry validator binds it.
        createInternalReplayContract('deleteGrooveTemplate'),
        // The guarded inverse of applyGroove; the application's own entry validator binds it.
        createInternalReplayContract('restoreGrooveAssignment'),
    ];
}
