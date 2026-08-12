import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { type RuntimeAction } from '../../models/RuntimeAction';

import { type BatchLocalActionIdentity } from './BatchLocalActionIdentity';

type MaterializeBatchLocalActionIdentitiesResult =
    { status: 'accepted'; actions: MaterializableRuntimeAction[] } | { status: 'rejected'; reason: string };

const GENERATED_BUS_ID_PATTERN = /^bus-ai-[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;
const GENERATED_DEVICE_ID_PATTERN = /^device-ai-[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

export function materializeBatchLocalActionIdentities(
    actions: readonly RuntimeAction[],
    identities: readonly BatchLocalActionIdentity[]
): MaterializeBatchLocalActionIdentitiesResult {
    const identitiesByKey = new Map<string, BatchLocalActionIdentity>();
    const busIds = new Set<string>();
    const deviceIds = new Set<string>();
    for (const identity of identities) {
        const identityId = identity.actionType === 'createBus' ? identity.busId : identity.deviceId;
        const hasValidId =
            identity.actionType === 'createBus'
                ? GENERATED_BUS_ID_PATTERN.test(identityId)
                : GENERATED_DEVICE_ID_PATTERN.test(identityId);
        const hasValidInitialGain =
            identity.actionType !== 'createBus' ||
            identity.initialGain === undefined ||
            (Number.isFinite(identity.initialGain) && identity.initialGain >= 0 && identity.initialGain <= 2);
        const identityKey = `${identity.actionType}:${String(identity.actionOrdinal)}`;
        if (
            !Number.isSafeInteger(identity.actionOrdinal) ||
            identity.actionOrdinal < 0 ||
            !hasValidId ||
            !hasValidInitialGain ||
            identitiesByKey.has(identityKey) ||
            busIds.has(identityId) ||
            deviceIds.has(identityId)
        ) {
            return { status: 'rejected', reason: 'Invalid or duplicate batch-local action identity' };
        }
        identitiesByKey.set(identityKey, identity);
        if (identity.actionType === 'createBus') {
            busIds.add(identity.busId);
        } else {
            deviceIds.add(identity.deviceId);
        }
    }

    let createBusOrdinal = 0;
    let addDeviceOrdinal = 0;
    const consumedKeys = new Set<string>();
    const executableActions = actions.map((action): MaterializableRuntimeAction => {
        if (action.type === 'createBus') {
            const ordinal = createBusOrdinal++;
            const identityKey = `createBus:${String(ordinal)}`;
            const identity = identitiesByKey.get(identityKey);
            if (!identity || identity.actionType !== 'createBus') {
                return action;
            }
            consumedKeys.add(identityKey);
            return {
                type: 'createBus',
                payload: {
                    ...action.payload,
                    busId: identity.busId,
                    ...(identity.initialGain !== undefined ? { initialGain: identity.initialGain } : {}),
                    ...(identity.expectedAbsentTrackNames !== undefined
                        ? { expectedAbsentTrackNames: identity.expectedAbsentTrackNames }
                        : {}),
                    ...(identity.expectedTrackOutputs !== undefined
                        ? { expectedTrackOutputs: identity.expectedTrackOutputs }
                        : {}),
                },
            };
        }
        if (action.type !== 'addDevice') {
            return action;
        }
        const ordinal = addDeviceOrdinal++;
        const identityKey = `addDevice:${String(ordinal)}`;
        const identity = identitiesByKey.get(identityKey);
        if (!identity || identity.actionType !== 'addDevice') {
            return action;
        }
        consumedKeys.add(identityKey);
        return {
            type: 'addDevice',
            payload: { ...action.payload, deviceId: identity.deviceId },
        };
    });

    if (consumedKeys.size !== identitiesByKey.size) {
        const unmatchedIdentity = identities.find((identity) => {
            const identityKey = `${identity.actionType}:${String(identity.actionOrdinal)}`;
            return !consumedKeys.has(identityKey);
        });
        return {
            status: 'rejected',
            reason: `Batch-local action identity has no validated ${unmatchedIdentity?.actionType ?? 'creation'} action`,
        };
    }
    return { status: 'accepted', actions: executableActions };
}
