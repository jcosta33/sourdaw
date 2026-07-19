import { canonicalizeGrooveConsumerId } from '../../models/GrooveTemplateState';

type GetScopedGrooveConsumerIdInput = {
    ownerId: string;
    localId: string;
};

export function getScopedGrooveConsumerId({ ownerId, localId }: GetScopedGrooveConsumerIdInput): string {
    const canonicalOwnerId = canonicalizeGrooveConsumerId(ownerId);
    const canonicalLocalId = canonicalizeGrooveConsumerId(localId);
    if (!canonicalOwnerId || !canonicalLocalId) {
        throw new Error('Cannot scope groove consumer: owner and local IDs must be canonical');
    }
    return `groove-consumer:${encodeURIComponent(canonicalOwnerId)}:${encodeURIComponent(canonicalLocalId)}`;
}
