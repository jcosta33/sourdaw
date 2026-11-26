import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';
import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type ToasterMasterGainAction, type ToasterMasterGainCapture } from '../events/toasterAppActions';

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

export function validToasterMasterGainAction(payload: unknown): payload is ToasterMasterGainAction['payload'] {
    return (
        isRecord(payload) &&
        Object.keys(payload).length === 5 &&
        isNonemptyString(payload.deviceId) &&
        isNonemptyString(payload.trackId) &&
        Array.isArray(payload.deviceIds) &&
        Array.from(payload.deviceIds).every(isNonemptyString) &&
        new Set(payload.deviceIds).size === payload.deviceIds.length &&
        payload.deviceIds.includes(payload.deviceId) &&
        isMasterCapture(payload.before) &&
        isMasterCapture(payload.after) &&
        (payload.before.kind === 'value' || payload.after.kind === 'value') &&
        !valuesEqual(payload.before, payload.after)
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
