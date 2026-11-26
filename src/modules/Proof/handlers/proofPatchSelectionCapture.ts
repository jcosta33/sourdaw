import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';
import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import {
    type ProofPatchSelection,
    type ProofPatchSelectionAction,
    type ProofPatchSelectionSnapshot,
} from '../events/proofAppActions';
import { DEFAULT_PATCH, TARGET_LUFS } from '../models/ProofPatch';
import { proofPatchSelectionParameterIds } from '../services/proofPatchSelectionParameterIds';
import { readRestoredProofTarget } from '../services/proofTargetCodec';
import { proofPatchSelectionParameters } from '../useCases/proofPatchSelectionParameters';
import { getProofFactoryPreset, PROOF_PRESETS } from '../useCases/proofPresets';

type Payload = ProofPatchSelectionAction['payload'];

function presentString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function namesUniqueOwner(deviceIds: unknown, deviceId: string): boolean {
    return (
        Array.isArray(deviceIds) &&
        Array.from(deviceIds).every(presentString) &&
        new Set(deviceIds).size === deviceIds.length &&
        deviceIds.includes(deviceId)
    );
}

function isSelection(value: unknown): value is ProofPatchSelection {
    if (!isRecord(value) || Object.keys(value).length !== 2) {
        return false;
    }
    if (value.kind === 'preset') {
        return typeof value.presetId === 'string' && getProofFactoryPreset(value.presetId) !== undefined;
    }
    return value.kind === 'target' && typeof value.target === 'string' && Object.hasOwn(TARGET_LUFS, value.target);
}

function validParameters(parameters: unknown, parameterIds: readonly string[]): boolean {
    return (
        isRecord(parameters) &&
        Object.keys(parameters).length === parameterIds.length &&
        parameterIds.every((key) => {
            const value = parameters[key];
            return (
                Object.hasOwn(parameters, key) &&
                (value === null ||
                    (typeof value === 'number' &&
                        Number.isFinite(value) &&
                        clampDeviceParameterValue({ deviceType: 'proof', paramId: key, value }) === value))
            );
        })
    );
}

function isSnapshot(value: unknown, parameterIds: readonly string[]): value is ProofPatchSelectionSnapshot {
    if (!isRecord(value) || Object.keys(value).length !== 3 || !validParameters(value.parameters, parameterIds)) {
        return false;
    }
    if (typeof value.presetId === 'string') {
        return getProofFactoryPreset(value.presetId)?.name === value.name && typeof value.name === 'string';
    }
    return (
        value.presetId === null &&
        (value.name === DEFAULT_PATCH.name || PROOF_PRESETS.some((preset) => preset.name === value.name))
    );
}

function matchesSelection(
    selection: ProofPatchSelection,
    snapshot: ProofPatchSelectionSnapshot,
    previous: ProofPatchSelectionSnapshot
): boolean {
    if (!valuesEqual(snapshot.parameters, proofPatchSelectionParameters(selection))) {
        return false;
    }
    if (selection.kind === 'preset') {
        return snapshot.presetId === selection.presetId;
    }
    const previousTarget = readRestoredProofTarget(previous.parameters) ?? DEFAULT_PATCH;
    return (
        snapshot.name === previous.name &&
        (snapshot.presetId === null ||
            (snapshot.presetId === previous.presetId &&
                previousTarget.target === selection.target &&
                previousTarget.targetLufs === TARGET_LUFS[selection.target]))
    );
}

export function validProofPatchSelectionCapture(payload: unknown): payload is Payload {
    if (
        !isRecord(payload) ||
        Object.keys(payload).length !== 6 ||
        !presentString(payload.deviceId) ||
        !presentString(payload.trackId) ||
        !namesUniqueOwner(payload.deviceIds, payload.deviceId) ||
        !isSelection(payload.selection)
    ) {
        return false;
    }
    const parameters = proofPatchSelectionParameterIds(payload.selection.kind);
    return (
        isSnapshot(payload.before, parameters) &&
        isSnapshot(payload.after, parameters) &&
        (matchesSelection(payload.selection, payload.after, payload.before) ||
            matchesSelection(payload.selection, payload.before, payload.after))
    );
}

export function invertProofPatchSelection(action: ProofPatchSelectionAction): ProofPatchSelectionAction {
    const { before, after } = action.payload;
    return { type: action.type, payload: { ...action.payload, before: after, after: before } };
}

export function isProofPatchSelectionSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    return (
        action.type === 'setProofPatchSelection' &&
        validProofPatchSelectionCapture(action.payload) &&
        matchesSelection(action.payload.selection, action.payload.after, action.payload.before) &&
        !valuesEqual(action.payload.before.parameters, action.payload.after.parameters) &&
        valuesEqual(inverseAction, invertProofPatchSelection(action)) &&
        valuesEqual(redoAction, action)
    );
}
