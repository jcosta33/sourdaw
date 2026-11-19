import { isRecord } from '#/utils/structuralEquality';

export type PreparedAudioBufferOwner = {
    schemaVersion: 1;
    createdAtMs?: number;
    leaseId: string;
    persistenceRevision?: string;
    promotionRevision?: string;
    status: 'project-owned' | 'temporary';
};

export type PreparedAudioBufferMetadata = {
    freezeProjectId?: number;
    lastAccessed: number;
    persistenceRevision?: string;
    preparedOwner?: PreparedAudioBufferOwner;
    sizeInBytes: number;
};

function isOptionalRevision(value: unknown): value is string | undefined {
    return value === undefined || (typeof value === 'string' && value.trim().length > 0);
}

function isOptionalTimestamp(value: unknown): value is number | undefined {
    return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isPreparedStatus(
    status: unknown,
    promotionRevision: string | undefined
): status is PreparedAudioBufferOwner['status'] {
    return status === 'project-owned' || (status === 'temporary' && promotionRevision === undefined);
}

function decodePreparedOwner(candidate: Record<string, unknown>): PreparedAudioBufferOwner | 'invalid' {
    const { createdAtMs, leaseId, persistenceRevision, promotionRevision, status } = candidate;
    if (
        candidate.schemaVersion !== 1 ||
        typeof leaseId !== 'string' ||
        leaseId.trim().length === 0 ||
        !isOptionalRevision(persistenceRevision) ||
        !isOptionalRevision(promotionRevision) ||
        !isOptionalTimestamp(createdAtMs) ||
        !isPreparedStatus(status, promotionRevision)
    ) {
        return 'invalid';
    }
    const validated: PreparedAudioBufferOwner = { schemaVersion: 1, leaseId, status };
    if (createdAtMs !== undefined) {
        validated.createdAtMs = createdAtMs;
    }
    if (persistenceRevision !== undefined) {
        validated.persistenceRevision = persistenceRevision;
    }
    if (promotionRevision !== undefined) {
        validated.promotionRevision = promotionRevision;
    }
    return validated;
}

export function readPreparedOwner(metadata: unknown): PreparedAudioBufferOwner | null | 'invalid' {
    if (metadata === undefined) {
        return null;
    }
    if (!isRecord(metadata)) {
        return 'invalid';
    }
    const owner = metadata.preparedOwner;
    if (owner === undefined) {
        return null;
    }
    if (!isRecord(owner) || metadata.persistenceRevision !== undefined) {
        return 'invalid';
    }
    return decodePreparedOwner(owner);
}

export function readPersistentPcmRevision(metadata: unknown): string | null {
    if (!isRecord(metadata)) {
        return null;
    }
    const owner = readPreparedOwner(metadata);
    if (owner === 'invalid') {
        return null;
    }
    if (owner !== null) {
        return owner.persistenceRevision ?? null;
    }
    const revision = metadata.persistenceRevision;
    return isOptionalRevision(revision) ? (revision ?? null) : null;
}

export function requiresPromotionReconciliation(
    owner: PreparedAudioBufferOwner
): owner is PreparedAudioBufferOwner & { promotionRevision: string; status: 'project-owned' } {
    return owner.status === 'project-owned' && owner.promotionRevision !== undefined;
}
