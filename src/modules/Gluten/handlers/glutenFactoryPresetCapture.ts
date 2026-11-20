import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';
import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type GlutenFactoryPresetAction } from '../events/glutenAppActions';
import { GLUTEN_PRESET_PARAMETER_ORDER } from '../models/GlutenPresetParameterOrder';
import { getGlutenFactoryPreset } from '../useCases/getGlutenFactoryPreset';
import { encodeGlutenPresetParameters } from '../useCases/glutenParamBridge/encodeGlutenPresetParameters';

type Payload = GlutenFactoryPresetAction['payload'];

function presentString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isPresetFootprint(value: unknown): value is Payload['before'] {
    return (
        isRecord(value) &&
        Object.keys(value).length === GLUTEN_PRESET_PARAMETER_ORDER.length &&
        GLUTEN_PRESET_PARAMETER_ORDER.every((key) => {
            const parameter = value[key];
            return (
                Object.hasOwn(value, key) &&
                (parameter === null ||
                    (typeof parameter === 'number' &&
                        Number.isFinite(parameter) &&
                        clampDeviceParameterValue({ deviceType: 'gluten', paramId: key, value: parameter }) ===
                            parameter))
            );
        })
    );
}

function matchesFactoryPreset(presetId: string, parameters: Payload['after']): boolean {
    const preset = getGlutenFactoryPreset(presetId);
    return preset !== undefined && valuesEqual(encodeGlutenPresetParameters(preset.patch), parameters);
}

export function validGlutenFactoryPresetCapture(payload: unknown): payload is Payload {
    return (
        isRecord(payload) &&
        Object.keys(payload).length === 6 &&
        presentString(payload.deviceId) &&
        presentString(payload.trackId) &&
        presentString(payload.presetId) &&
        Array.isArray(payload.deviceIds) &&
        Array.from(payload.deviceIds).every(presentString) &&
        new Set(payload.deviceIds).size === payload.deviceIds.length &&
        payload.deviceIds.includes(payload.deviceId) &&
        isPresetFootprint(payload.before) &&
        isPresetFootprint(payload.after) &&
        (matchesFactoryPreset(payload.presetId, payload.after) ||
            matchesFactoryPreset(payload.presetId, payload.before))
    );
}

export function invertGlutenFactoryPresetAction(action: GlutenFactoryPresetAction): GlutenFactoryPresetAction {
    const { before, after } = action.payload;
    return { type: action.type, payload: { ...action.payload, before: after, after: before } };
}

export function isGlutenFactoryPresetSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    return (
        action.type === 'setGlutenFactoryPreset' &&
        validGlutenFactoryPresetCapture(action.payload) &&
        matchesFactoryPreset(action.payload.presetId, action.payload.after) &&
        !valuesEqual(action.payload.before, action.payload.after) &&
        valuesEqual(inverseAction, invertGlutenFactoryPresetAction(action)) &&
        valuesEqual(redoAction, action)
    );
}
