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

/** A forward command whose own handler validates the whole undo entry it recorded. */
function createOwnerEntryReplayContract(
    actionType: 'commitRecording' | 'editTempoMap' | 'deleteTime' | 'zoomTracksVertical'
): SessionActionContract {
    return {
        actionType,
        operationVersion: 1,
        role: 'forward',
        validateArguments: (payload: unknown) => validateVersionedCommandArguments(actionType, payload),
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
 * Not an agent command, but a person's vertical zoom is undoable and its undo survives a reload. The
 * inverse restores the heights the zoom clamped from, and the zoom's own entry validator binds it.
 */
function createVerticalZoomReplayContracts(): readonly SessionActionContract[] {
    return [createOwnerEntryReplayContract('zoomTracksVertical'), createInternalReplayContract('restoreTrackHeights')];
}

/**
 * Local actions and internal inverse actions are replayable session state, not
 * provider operations. Keep these contracts separate from executable discovery
 * while injecting them into the store-owned mirror at production registration.
 */
export function getInternalUndoSessionReplayContracts(): readonly SessionActionContract[] {
    return [
        createOwnerEntryReplayContract('commitRecording'),
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
        createOwnerEntryReplayContract('editTempoMap'),
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
        createOwnerEntryReplayContract('deleteTime'),
        ...createVerticalZoomReplayContracts(),
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
