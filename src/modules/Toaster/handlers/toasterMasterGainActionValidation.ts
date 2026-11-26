import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';
import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type ToasterMasterGainAction } from '../events/toasterAppActions';
import { type ToasterMasterGainCapture } from '../models/ToasterMasterGainPatch';

function isNonemptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isMasterCapture(value: unknown): value is ToasterMasterGainCapture {
    if (!isRecord(value) || !Object.hasOwn(value, 'kind')) {
        return false;
    }
    if (value.kind === 'value') {
        const gain = value.value;
        return (
            Object.keys(value).length === 2 &&
            Object.hasOwn(value, 'value') &&
            typeof gain === 'number' &&
            Number.isFinite(gain) &&
            clampDeviceParameterValue({ deviceType: DEVICE_TYPE_IDS.toaster, paramId: 'masterGain', value: gain }) ===
                gain
        );
    }
    return (
        Object.keys(value).length === 1 &&
        (value.kind === 'missing-chunk' || value.kind === 'missing-kit' || value.kind === 'missing-gain')
    );
}

function hasDistinctDeviceIds(deviceIds: unknown, deviceId: string): boolean {
    return (
        Array.isArray(deviceIds) &&
        Array.from(deviceIds).every(isNonemptyString) &&
        new Set(deviceIds).size === deviceIds.length &&
        deviceIds.includes(deviceId)
    );
}

function hasDistinctMasterCaptures(payload: Record<string, unknown>): boolean {
    return (
        isMasterCapture(payload.before) &&
        isMasterCapture(payload.after) &&
        (payload.before.kind === 'value' || payload.after.kind === 'value') &&
        !valuesEqual(payload.before, payload.after)
    );
}

export function validToasterMasterGainAction(payload: unknown): payload is ToasterMasterGainAction['payload'] {
    return (
        isRecord(payload) &&
        Object.keys(payload).length === 5 &&
        isNonemptyString(payload.deviceId) &&
        isNonemptyString(payload.trackId) &&
        hasDistinctDeviceIds(payload.deviceIds, payload.deviceId) &&
        hasDistinctMasterCaptures(payload)
    );
}

export function invertToasterMasterGainAction(action: ToasterMasterGainAction): ToasterMasterGainAction {
    const { before, after } = action.payload;
    return { type: action.type, payload: { ...action.payload, before: after, after: before } };
}

export function isToasterMasterGainSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    return (
        action.type === 'setToasterMasterGain' &&
        validToasterMasterGainAction(action.payload) &&
        action.payload.after.kind === 'value' &&
        valuesEqual(inverseAction, invertToasterMasterGainAction(action)) &&
        valuesEqual(redoAction, action)
    );
}
