import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';
import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type CrustFactoryPresetAction } from '../events/crustAppActions';
import { CRUST_PRESET_PARAMETER_ORDER } from '../models/CrustPresetParameterOrder';
import { getCrustFactoryPreset } from '../useCases/crustPresets';
import { encodeCrustPresetParameters } from '../useCases/crustParamBridge/encodeCrustPresetParameters';

type Payload = CrustFactoryPresetAction['payload'];

function presentString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isPresetFootprint(value: unknown): value is Payload['before'] {
    return (
        isRecord(value) &&
        Object.keys(value).length === CRUST_PRESET_PARAMETER_ORDER.length &&
        CRUST_PRESET_PARAMETER_ORDER.every((key) => {
            const parameter = value[key];
            return (
                Object.hasOwn(value, key) &&
                (parameter === null ||
                    (typeof parameter === 'number' &&
                        Number.isFinite(parameter) &&
                        clampDeviceParameterValue({ deviceType: 'crust', paramId: key, value: parameter }) ===
                            parameter))
            );
        })
    );
}

function matchesFactoryPreset(presetId: string, parameters: Payload['after']): boolean {
    const preset = getCrustFactoryPreset(presetId);
    return preset !== undefined && valuesEqual(encodeCrustPresetParameters(preset.patch), parameters);
}

function namesUniqueOwner(deviceIds: unknown, deviceId: string): boolean {
    return (
        Array.isArray(deviceIds) &&
        Array.from(deviceIds).every(presentString) &&
        new Set(deviceIds).size === deviceIds.length &&
        deviceIds.includes(deviceId)
    );
}

export function validCrustFactoryPresetCapture(payload: unknown): payload is Payload {
    return (
        isRecord(payload) &&
        Object.keys(payload).length === 8 &&
        presentString(payload.deviceId) &&
        presentString(payload.trackId) &&
        presentString(payload.trackObjectId) &&
        presentString(payload.deviceObjectId) &&
        presentString(payload.presetId) &&
        namesUniqueOwner(payload.deviceIds, payload.deviceId) &&
        isPresetFootprint(payload.before) &&
        isPresetFootprint(payload.after) &&
        (matchesFactoryPreset(payload.presetId, payload.after) ||
            matchesFactoryPreset(payload.presetId, payload.before))
    );
}

export function invertCrustFactoryPresetAction(action: CrustFactoryPresetAction): CrustFactoryPresetAction {
    const { before, after } = action.payload;
    return { type: action.type, payload: { ...action.payload, before: after, after: before } };
}

export function isCrustFactoryPresetSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    return (
        action.type === 'setCrustFactoryPreset' &&
        validCrustFactoryPresetCapture(action.payload) &&
        matchesFactoryPreset(action.payload.presetId, action.payload.after) &&
        !valuesEqual(action.payload.before, action.payload.after) &&
        valuesEqual(inverseAction, invertCrustFactoryPresetAction(action)) &&
        valuesEqual(redoAction, action)
    );
}
