import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type ToasterFactoryKitAction } from '../events/toasterAppActions';
import { validToasterKitReplacement } from '../models/ToasterFactoryKitCapture';

type Payload = ToasterFactoryKitAction['payload'];

function isNonemptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

export function validToasterFactoryKitCapture(payload: unknown): payload is Payload {
    return (
        isRecord(payload) &&
        Object.keys(payload).length === 6 &&
        isNonemptyString(payload.deviceId) &&
        isNonemptyString(payload.trackId) &&
        isNonemptyString(payload.label) &&
        Array.isArray(payload.deviceIds) &&
        Array.from(payload.deviceIds).every(isNonemptyString) &&
        new Set(payload.deviceIds).size === payload.deviceIds.length &&
        payload.deviceIds.includes(payload.deviceId) &&
        validToasterKitReplacement(payload.before, payload.after)
    );
}

export function invertToasterFactoryKitAction(action: ToasterFactoryKitAction): ToasterFactoryKitAction {
    const { before, after } = action.payload;
    return { type: action.type, payload: { ...action.payload, before: after, after: before } };
}

export function isToasterFactoryKitSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    return (
        action.type === 'setToasterFactoryKit' &&
        validToasterFactoryKitCapture(action.payload) &&
        !valuesEqual(action.payload.before, action.payload.after) &&
        valuesEqual(inverseAction, invertToasterFactoryKitAction(action)) &&
        valuesEqual(redoAction, action)
    );
}
