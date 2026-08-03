import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { type RuntimeAction } from '../../models/RuntimeAction';

import { type BatchLocalActionIdentity } from './bridgeGroundedLlmToolCalls';

type MaterializeBatchLocalActionIdentitiesResult =
    { status: 'accepted'; actions: ExecutableRuntimeAction[] } | { status: 'rejected'; reason: string };

const GENERATED_BUS_ID_PATTERN = /^bus-ai-[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

export function materializeBatchLocalActionIdentities(
    actions: readonly RuntimeAction[],
    identities: readonly BatchLocalActionIdentity[]
): MaterializeBatchLocalActionIdentitiesResult {
    const identitiesByOrdinal = new Map<number, BatchLocalActionIdentity>();
    const busIds = new Set<string>();
    for (const identity of identities) {
        if (
            !Number.isSafeInteger(identity.actionOrdinal) ||
            identity.actionOrdinal < 0 ||
            !GENERATED_BUS_ID_PATTERN.test(identity.busId) ||
            identitiesByOrdinal.has(identity.actionOrdinal) ||
            busIds.has(identity.busId)
        ) {
            return { status: 'rejected', reason: 'Invalid or duplicate batch-local action identity' };
        }
        identitiesByOrdinal.set(identity.actionOrdinal, identity);
        busIds.add(identity.busId);
    }

    let createBusOrdinal = 0;
    const consumedOrdinals = new Set<number>();
    const executableActions = actions.map((action): ExecutableRuntimeAction => {
        if (action.type !== 'createBus') {
            return action;
        }
        const ordinal = createBusOrdinal;
        createBusOrdinal += 1;
        const identity = identitiesByOrdinal.get(ordinal);
        if (!identity) {
            return action;
        }
        consumedOrdinals.add(ordinal);
        return {
            type: 'createBus',
            payload: { ...action.payload, busId: identity.busId },
        };
    });

    if (consumedOrdinals.size !== identitiesByOrdinal.size) {
        return { status: 'rejected', reason: 'Batch-local action identity has no validated createBus action' };
    }
    return { status: 'accepted', actions: executableActions };
}
