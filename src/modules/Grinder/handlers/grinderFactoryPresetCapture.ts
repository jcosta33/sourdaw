import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type GrinderFactoryPresetAction } from '../events/grinderAppActions';
import { getRectifierHeavyPresetImage } from '../useCases/grinderParamBridge/getRectifierHeavyPresetImage';

type Payload = GrinderFactoryPresetAction['payload'];

const PRESET_FIELDS = new Set([
    'trackId',
    'deviceId',
    'deviceIds',
    'ownerIncarnation',
    'presetId',
    'before',
    'after',
    'direction',
]);

function hasNonemptyId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function hasExactTarget(value: Record<string, unknown>): boolean {
    const { trackId, deviceId, deviceIds, ownerIncarnation, presetId } = value;
    return (
        presetId === 'gr-rectifier-heavy' &&
        hasNonemptyId(trackId) &&
        hasNonemptyId(deviceId) &&
        isRecord(ownerIncarnation) &&
        Object.keys(ownerIncarnation).length === 2 &&
        hasNonemptyId(ownerIncarnation.trackObjectId) &&
        hasNonemptyId(ownerIncarnation.deviceObjectId) &&
        Array.isArray(deviceIds) &&
        deviceIds.every(hasNonemptyId) &&
        new Set(deviceIds).size === deviceIds.length &&
        deviceIds.includes(deviceId)
    );
}

function isCapturedValue(value: unknown): boolean {
    return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function capturesEveryParameter(before: Record<string, unknown>, image: Readonly<Record<string, number>>): boolean {
    const keys = Object.keys(image);
    return (
        Object.keys(before).length === keys.length &&
        keys.every((key) => Object.hasOwn(before, key) && isCapturedValue(before[key]))
    );
}

export function validGrinderFactoryPresetCapture(value: unknown): value is Payload {
    if (!isRecord(value) || !isRecord(value.before) || !isRecord(value.after)) {
        return false;
    }
    if (!hasExactTarget(value) || Object.keys(value).some((key) => !PRESET_FIELDS.has(key))) {
        return false;
    }
    if (value.direction !== undefined && value.direction !== 'undo') {
        return false;
    }
    const image = getRectifierHeavyPresetImage()?.parameterValues;
    return image !== undefined && capturesEveryParameter(value.before, image) && valuesEqual(value.after, image);
}

export function invertGrinderFactoryPresetAction(action: GrinderFactoryPresetAction): GrinderFactoryPresetAction {
    return { type: action.type, payload: { ...action.payload, direction: 'undo' } };
}

export function isGrinderFactoryPresetSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const action = entry.action;
    return (
        action.type === 'setGrinderFactoryPreset' &&
        validGrinderFactoryPresetCapture(action.payload) &&
        action.payload.direction === undefined &&
        !valuesEqual(action.payload.before, action.payload.after) &&
        valuesEqual(entry.inverseAction, invertGrinderFactoryPresetAction(action)) &&
        valuesEqual(entry.redoAction, action)
    );
}
