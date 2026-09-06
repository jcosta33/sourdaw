import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { type RuntimeAction } from '../../models/RuntimeAction';

import { type BatchLocalActionIdentity } from './BatchLocalActionIdentity';

type MaterializeBatchLocalActionIdentitiesResult =
    { status: 'accepted'; actions: MaterializableRuntimeAction[] } | { status: 'rejected'; reason: string };

const GENERATED_ID_SUFFIX = String.raw`[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$`;
const GENERATED_BUS_ID_PATTERN = new RegExp(`^bus-ai-${GENERATED_ID_SUFFIX}`, 'u');
const GENERATED_DEVICE_ID_PATTERN = new RegExp(`^device-ai-${GENERATED_ID_SUFFIX}`, 'u');
const GENERATED_INITIAL_DEVICE_ID_PATTERN = new RegExp(`^device-command-${GENERATED_ID_SUFFIX}`, 'u');
const GENERATED_TRACK_ID_PATTERN = new RegExp(`^track-ai-${GENERATED_ID_SUFFIX}`, 'u');
const GENERATED_CLIP_ID_PATTERN = new RegExp(`^clip-ai-${GENERATED_ID_SUFFIX}`, 'u');

const GENERATED_ID_PATTERNS: Readonly<Record<BatchLocalActionIdentity['actionType'], RegExp>> = {
    addClip: GENERATED_CLIP_ID_PATTERN,
    addDevice: GENERATED_DEVICE_ID_PATTERN,
    addTrack: GENERATED_TRACK_ID_PATTERN,
    createBus: GENERATED_BUS_ID_PATTERN,
};

function getIdentityId(identity: BatchLocalActionIdentity): string {
    if (identity.actionType === 'createBus') {
        return identity.busId;
    }
    if (identity.actionType === 'addDevice') {
        return identity.deviceId;
    }
    return identity.actionType === 'addTrack' ? identity.trackId : identity.clipId;
}

function hasValidInitialGain(identity: BatchLocalActionIdentity): boolean {
    if (identity.actionType !== 'createBus' || identity.initialGain === undefined) {
        return true;
    }
    return Number.isFinite(identity.initialGain) && identity.initialGain >= 0 && identity.initialGain <= 2;
}

function hasValidInitialTrackDeviceId(identity: BatchLocalActionIdentity): boolean {
    return (
        identity.actionType !== 'addTrack' ||
        identity.initialDeviceId === undefined ||
        GENERATED_INITIAL_DEVICE_ID_PATTERN.test(identity.initialDeviceId)
    );
}

function getIdentityKey(identity: BatchLocalActionIdentity): string {
    return `${identity.actionType}:${String(identity.actionOrdinal)}`;
}

function indexBatchLocalActionIdentities(
    identities: readonly BatchLocalActionIdentity[]
): ReadonlyMap<string, BatchLocalActionIdentity> | null {
    const identitiesByKey = new Map<string, BatchLocalActionIdentity>();
    const assignedIds = new Set<string>();
    for (const identity of identities) {
        const identityId = getIdentityId(identity);
        const identityKey = getIdentityKey(identity);
        if (
            !Number.isSafeInteger(identity.actionOrdinal) ||
            identity.actionOrdinal < 0 ||
            !GENERATED_ID_PATTERNS[identity.actionType].test(identityId) ||
            !hasValidInitialGain(identity) ||
            !hasValidInitialTrackDeviceId(identity) ||
            identitiesByKey.has(identityKey) ||
            assignedIds.has(identityId) ||
            (identity.actionType === 'addTrack' &&
                identity.initialDeviceId !== undefined &&
                assignedIds.has(identity.initialDeviceId))
        ) {
            return null;
        }
        identitiesByKey.set(identityKey, identity);
        assignedIds.add(identityId);
        if (identity.actionType === 'addTrack' && identity.initialDeviceId !== undefined) {
            assignedIds.add(identity.initialDeviceId);
        }
    }
    return identitiesByKey;
}

function applyCreateBusIdentity(
    action: Extract<RuntimeAction, { type: 'createBus' }>,
    identity: Extract<BatchLocalActionIdentity, { actionType: 'createBus' }>
): MaterializableRuntimeAction {
    return {
        type: 'createBus',
        payload: {
            ...action.payload,
            busId: identity.busId,
            ...(identity.initialGain === undefined ? {} : { initialGain: identity.initialGain }),
            ...(identity.expectedAbsentTrackNames === undefined
                ? {}
                : { expectedAbsentTrackNames: identity.expectedAbsentTrackNames }),
            ...(identity.expectedTrackOutputs === undefined
                ? {}
                : { expectedTrackOutputs: identity.expectedTrackOutputs }),
        },
    };
}

function applyBatchLocalActionIdentity(
    action: RuntimeAction,
    identity: BatchLocalActionIdentity
): MaterializableRuntimeAction | null {
    if (action.type === 'createBus' && identity.actionType === 'createBus') {
        return applyCreateBusIdentity(action, identity);
    }
    if (action.type === 'addDevice' && identity.actionType === 'addDevice') {
        return { type: 'addDevice', payload: { ...action.payload, deviceId: identity.deviceId } };
    }
    if (action.type === 'addTrack' && identity.actionType === 'addTrack') {
        return {
            type: 'addTrack',
            payload: {
                ...action.payload,
                id: identity.trackId,
                ...(identity.initialDeviceId === undefined ? {} : { initialDeviceId: identity.initialDeviceId }),
            },
        };
    }
    if (action.type === 'addClip' && identity.actionType === 'addClip') {
        return { type: 'addClip', payload: { ...action.payload, id: identity.clipId } };
    }
    return null;
}

function isCreationActionType(actionType: string): actionType is BatchLocalActionIdentity['actionType'] {
    return Object.hasOwn(GENERATED_ID_PATTERNS, actionType);
}

export function materializeBatchLocalActionIdentities(
    actions: readonly RuntimeAction[],
    identities: readonly BatchLocalActionIdentity[]
): MaterializeBatchLocalActionIdentitiesResult {
    const identitiesByKey = indexBatchLocalActionIdentities(identities);
    if (identitiesByKey === null) {
        return { status: 'rejected', reason: 'Invalid or duplicate batch-local action identity' };
    }

    const ordinalsByActionType = new Map<string, number>();
    const consumedKeys = new Set<string>();
    const executableActions = actions.map((action): MaterializableRuntimeAction => {
        if (!isCreationActionType(action.type)) {
            return action;
        }
        const ordinal = ordinalsByActionType.get(action.type) ?? 0;
        ordinalsByActionType.set(action.type, ordinal + 1);
        const identityKey = `${action.type}:${String(ordinal)}`;
        const identity = identitiesByKey.get(identityKey);
        const materialized = identity === undefined ? null : applyBatchLocalActionIdentity(action, identity);
        if (materialized === null) {
            return action;
        }
        consumedKeys.add(identityKey);
        return materialized;
    });

    if (consumedKeys.size !== identitiesByKey.size) {
        const unmatchedIdentity = identities.find((identity) => !consumedKeys.has(getIdentityKey(identity)));
        return {
            status: 'rejected',
            reason: `Batch-local action identity has no validated ${unmatchedIdentity?.actionType ?? 'creation'} action`,
        };
    }
    return { status: 'accepted', actions: executableActions };
}
