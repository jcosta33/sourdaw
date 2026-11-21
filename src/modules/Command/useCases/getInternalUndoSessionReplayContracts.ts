import {
    type InternalReplayActionType,
    internalReplayOwnerValidationByActionType,
} from '../models/InternalReplayOwnerValidation';
import { getHandlerByType } from '../stores/handlerRegistry';

import { validateTransportBarsSessionEntry } from './validateTransportBarsSessionEntry';
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

/**
 * A recorded automation pass begins its entry with this inverse; the owner keeps only the
 * pass whose undo restores exactly what it replaced.
 */
function createEntryBeginningReplayContract(actionType: 'restoreAutomationLanePoints'): SessionActionContract {
    return {
        ...createInternalReplayContract(actionType),
        validateEntry: (entry) => getHandlerByType(actionType)?.validateSessionEntry?.(entry) === true,
    };
}

function createCapturedDeviceReplayContract(
    actionType: 'setBacteriaFactoryPatch' | 'setGlutenFactoryPreset' | 'setLevainIdentity' | 'setToasterFactoryKit'
): SessionActionContract {
    return {
        actionType,
        operationVersion: 1,
        role: 'forward',
        validateArguments: (payload: unknown) =>
            validateVersionedCommandArguments(actionType, payload) &&
            getHandlerByType(actionType)?.validateSessionActionArguments?.(payload) === true,
        validateEntry: (entry) => getHandlerByType(actionType)?.validateSessionEntry?.(entry) === true,
    };
}

function createTransportBarsReplayContract(actionType: 'setCountInBars' | 'setPreRollBars'): SessionActionContract {
    return {
        actionType,
        operationVersion: 1,
        role: 'forward',
        validateArguments: (payload: unknown) => validateVersionedCommandArguments(actionType, payload),
        validateEntry: (entry) => validateTransportBarsSessionEntry(actionType, entry),
    };
}

function createTransportBarsReplayContracts(): readonly SessionActionContract[] {
    return [createTransportBarsReplayContract('setCountInBars'), createTransportBarsReplayContract('setPreRollBars')];
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
        createCapturedDeviceReplayContract('setBacteriaFactoryPatch'),
        createCapturedDeviceReplayContract('setGlutenFactoryPreset'),
        createCapturedDeviceReplayContract('setLevainIdentity'),
        createCapturedDeviceReplayContract('setToasterFactoryKit'),
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
        ...createTransportBarsReplayContracts(),
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
        createEntryBeginningReplayContract('restoreAutomationLanePoints'),
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
