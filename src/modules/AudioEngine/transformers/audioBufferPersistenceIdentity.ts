import { isValidSerializedAudioBuffer, type SerializedAudioBuffer } from '../models/SerializedAudioBuffer';

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

export type PreparedSerializedAudioBuffer = SerializedAudioBuffer & {
    lastAccessed: number;
};

export function isValidPreparedSerializedAudioBuffer(data: unknown): data is PreparedSerializedAudioBuffer {
    return (
        isValidSerializedAudioBuffer(data) &&
        typeof (data as Record<string, unknown>).lastAccessed === 'number' &&
        Number.isFinite((data as Record<string, unknown>).lastAccessed)
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function readOwnerRevisions(
    { persistenceRevision, promotionRevision }: Record<string, unknown>,
    status: PreparedAudioBufferOwner['status']
): Pick<PreparedAudioBufferOwner, 'persistenceRevision' | 'promotionRevision'> | undefined {
    if (persistenceRevision !== undefined && !isNonEmptyString(persistenceRevision)) {
        return undefined;
    }
    if (promotionRevision !== undefined && (status === 'temporary' || !isNonEmptyString(promotionRevision))) {
        return undefined;
    }
    const revisions: Pick<PreparedAudioBufferOwner, 'persistenceRevision' | 'promotionRevision'> = {};
    if (persistenceRevision !== undefined) {
        revisions.persistenceRevision = persistenceRevision;
    }
    if (promotionRevision !== undefined) {
        revisions.promotionRevision = promotionRevision;
    }
    return revisions;
}

function readOwnerRecord(candidate: Record<string, unknown>): PreparedAudioBufferOwner | 'invalid' {
    const { schemaVersion, createdAtMs, leaseId, status } = candidate;
    if (schemaVersion !== 1 || !isNonEmptyString(leaseId) || (status !== 'temporary' && status !== 'project-owned')) {
        return 'invalid';
    }
    if (createdAtMs !== undefined && (typeof createdAtMs !== 'number' || !Number.isFinite(createdAtMs))) {
        return 'invalid';
    }
    const revisions = readOwnerRevisions(candidate, status);
    if (revisions === undefined) {
        return 'invalid';
    }
    const owner: PreparedAudioBufferOwner = { schemaVersion, leaseId, status, ...revisions };
    if (createdAtMs !== undefined) {
        owner.createdAtMs = createdAtMs;
    }
    return owner;
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
    return readOwnerRecord(owner);
}

export function readPersistentPcmRevision(metadata: unknown): string | null {
    if (!isRecord(metadata)) {
        return null;
    }
    const ordinaryRevision = metadata.persistenceRevision;
    const owner = readPreparedOwner(metadata);
    if (owner === 'invalid') {
        return null;
    }
    if (owner !== null) {
        return owner.persistenceRevision ?? null;
    }
    if (isNonEmptyString(ordinaryRevision)) {
        return ordinaryRevision;
    }
    return null;
}

export function requiresPromotionReconciliation(
    owner: PreparedAudioBufferOwner
): owner is PreparedAudioBufferOwner & { promotionRevision: string; status: 'project-owned' } {
    return owner.status === 'project-owned' && owner.promotionRevision !== undefined;
}

function isValidFreezeProjectId(value: unknown): boolean {
    return value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

/** Return the revision only for an intact, durably owned PCM and metadata pair. */
export function readDurableAudioBufferRevision(data: unknown, metadata: unknown): string | null {
    if (!isValidPreparedSerializedAudioBuffer(data) || !isRecord(metadata)) {
        return null;
    }
    if (
        typeof metadata.lastAccessed !== 'number' ||
        !Number.isFinite(metadata.lastAccessed) ||
        metadata.sizeInBytes !== data.sizeInBytes ||
        !isValidFreezeProjectId(metadata.freezeProjectId)
    ) {
        return null;
    }
    const owner = readPreparedOwner(metadata);
    if (
        owner === 'invalid' ||
        owner?.status === 'temporary' ||
        (owner !== null && requiresPromotionReconciliation(owner))
    ) {
        return null;
    }
    return readPersistentPcmRevision(metadata);
}
