import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type SetLevainIdentityAction } from '../events/levainAppActions';
import { LEVAIN_MISSING_DEVICE_STATE } from '../models/LevainDeviceState';
import { readLevainIdentityCapture } from '../models/LevainIdentityCapture';
import { createDefaultPatch } from '../models/LevainPatch';
import { projectLevainPresetParameters } from '../useCases/projectLevainPresetParameters';

function nonempty(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function readSnapshot(value: unknown) {
    if (!isRecord(value) || Object.keys(value).length !== 2 || !isRecord(value.parameterValues)) {
        return null;
    }
    const identity = readLevainIdentityCapture(value.deviceState);
    if (
        !identity ||
        !Object.values(value.parameterValues).every((number) => number === null || Number.isFinite(number))
    ) {
        return null;
    }
    return { identity, parameters: value.parameterValues };
}

type Capture = NonNullable<ReturnType<typeof readSnapshot>>;

function isPresetReset({ identity, parameters }: Capture): boolean {
    const patch = createDefaultPatch(identity.instrumentId);
    return (
        identity.bankArticulation === patch.currentArticulation &&
        valuesEqual(parameters, projectLevainPresetParameters(patch))
    );
}

function validAddress(payload: Record<string, unknown>): boolean {
    return (
        nonempty(payload.deviceId) &&
        nonempty(payload.trackId) &&
        nonempty(payload.label) &&
        Array.isArray(payload.deviceIds) &&
        Array.from(payload.deviceIds).every(nonempty) &&
        new Set(payload.deviceIds).size === payload.deviceIds.length &&
        payload.deviceIds.includes(payload.deviceId)
    );
}

function validPayloadKeys(payload: Record<string, unknown>): boolean {
    if (!Object.hasOwn(payload, 'restore')) {
        return Object.keys(payload).length === 8;
    }
    return payload.restore === true && Object.keys(payload).length === 9;
}

export function validLevainIdentityCapture(payload: unknown): payload is SetLevainIdentityAction['payload'] {
    if (
        !isRecord(payload) ||
        !validPayloadKeys(payload) ||
        !validAddress(payload) ||
        !valuesEqual(payload.missingDeviceState, LEVAIN_MISSING_DEVICE_STATE)
    ) {
        return false;
    }
    const before = readSnapshot(payload.before);
    const after = readSnapshot(payload.after);
    if (!before || !after || !valuesEqual(before.identity.unowned, after.identity.unowned)) {
        return false;
    }
    const keys = Object.keys(before.parameters).sort();
    if (!valuesEqual(keys, Object.keys(after.parameters).sort())) {
        return false;
    }
    const authored = payload.restore === true ? before : after;
    if (payload.kind === 'articulation') {
        return (
            keys.length === 0 &&
            before.identity.instrumentId === after.identity.instrumentId &&
            authored.identity.bankArticulation !== undefined
        );
    }
    return payload.kind === 'instrument' && isPresetReset(authored);
}

export function invertLevainIdentityAction(action: SetLevainIdentityAction): SetLevainIdentityAction {
    const { before, after, restore, ...target } = action.payload;
    const inverted = { ...target, before: after, after: before };
    return { type: action.type, payload: restore ? inverted : { ...inverted, restore: true } };
}

export function isLevainIdentitySessionEntry({
    action,
    inverseAction,
    redoAction,
}: HandlerSessionActionEntry): boolean {
    return (
        action.type === 'setLevainIdentity' &&
        validLevainIdentityCapture(action.payload) &&
        !action.payload.restore &&
        !valuesEqual(action.payload.before, action.payload.after) &&
        valuesEqual(inverseAction, invertLevainIdentityAction(action)) &&
        valuesEqual(redoAction, action)
    );
}
