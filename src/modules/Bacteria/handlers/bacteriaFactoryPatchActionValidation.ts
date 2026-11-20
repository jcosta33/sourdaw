import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type BacteriaFactoryPatchAction, type BacteriaFactoryPatchSnapshot } from '../events/bacteriaAppActions';
import { bacteriaFactoryParameters } from '../useCases/bacteriaParamBridge/bacteriaFactoryParameters';

type Payload = BacteriaFactoryPatchAction['payload'];

function validName(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

function validSnapshot(value: unknown): value is BacteriaFactoryPatchSnapshot {
    if (!isRecord(value) || Object.keys(value).length !== 3 || !validName(value.name)) {
        return false;
    }
    const { deviceState, parameterValues } = value;
    if (
        deviceState !== null &&
        !(isRecord(deviceState) && Number.isInteger(deviceState.version) && isRecord(deviceState.data))
    ) {
        return false;
    }
    return (
        isRecord(parameterValues) &&
        Object.entries(parameterValues).every(
            ([key, leaf]) =>
                bacteriaFactoryParameters.isKnownParameter(key) &&
                (leaf === null || (typeof leaf === 'number' && Number.isFinite(leaf)))
        )
    );
}

function validFootprint(before: BacteriaFactoryPatchSnapshot, after: BacteriaFactoryPatchSnapshot): boolean {
    const ids = Object.keys(before.parameterValues);
    return (
        ids.length === Object.keys(after.parameterValues).length &&
        ids.every(
            (id) =>
                Object.hasOwn(after.parameterValues, id) &&
                (before.parameterValues[id] === after.parameterValues[id] ||
                    bacteriaFactoryParameters.isAuthoredParameter(id))
        )
    );
}

export function validBacteriaFactoryPatchCapture(payload: unknown): payload is Payload {
    return (
        isRecord(payload) &&
        Object.keys(payload).length === 6 &&
        validName(payload.deviceId) &&
        validName(payload.trackId) &&
        validName(payload.label) &&
        Array.isArray(payload.deviceIds) &&
        Array.from(payload.deviceIds).every(validName) &&
        new Set(payload.deviceIds).size === payload.deviceIds.length &&
        payload.deviceIds.includes(payload.deviceId) &&
        validSnapshot(payload.before) &&
        validSnapshot(payload.after) &&
        validFootprint(payload.before, payload.after)
    );
}

export function invertBacteriaFactoryPatch(action: BacteriaFactoryPatchAction): BacteriaFactoryPatchAction {
    const { before, after } = action.payload;
    return { ...action, payload: { ...action.payload, before: after, after: before } };
}

export function isBacteriaFactoryPatchSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    return (
        action.type === 'setBacteriaFactoryPatch' &&
        validBacteriaFactoryPatchCapture(action.payload) &&
        valuesEqual(inverseAction, invertBacteriaFactoryPatch(action)) &&
        valuesEqual(redoAction, action)
    );
}
