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
    preparedOwner?: PreparedAudioBufferOwner;
    sizeInBytes: number;
};

export type PreparedSerializedAudioBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    channelData: Float32Array[];
    lastAccessed: number;
    sizeInBytes: number;
};

export function preparedIdentityFailure(id: string, leaseId: string): string | undefined {
    if (id.trim().length === 0) {
        return 'Prepared audio buffer ID is invalid.';
    }
    if (leaseId.trim().length === 0) {
        return 'Prepared audio lease ID is invalid.';
    }
    return undefined;
}

export function readPreparedOwner(metadata: unknown): PreparedAudioBufferOwner | null | 'invalid' {
    if (metadata === undefined) {
        return null;
    }
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return 'invalid';
    }
    const owner = (metadata as Record<string, unknown>).preparedOwner;
    if (owner === undefined) {
        return null;
    }
    if (owner === null || typeof owner !== 'object' || Array.isArray(owner)) {
        return 'invalid';
    }
    const candidate = owner as Record<string, unknown>;
    const createdAtMs = candidate.createdAtMs;
    const leaseId = candidate.leaseId;
    const persistenceRevision = candidate.persistenceRevision;
    const promotionRevision = candidate.promotionRevision;
    const status = candidate.status;
    if (
        candidate.schemaVersion !== 1 ||
        typeof leaseId !== 'string' ||
        leaseId.trim().length === 0 ||
        (persistenceRevision !== undefined &&
            (typeof persistenceRevision !== 'string' || persistenceRevision.trim().length === 0)) ||
        (promotionRevision !== undefined &&
            (typeof promotionRevision !== 'string' || promotionRevision.trim().length === 0)) ||
        (status === 'temporary' && promotionRevision !== undefined) ||
        (createdAtMs !== undefined && (typeof createdAtMs !== 'number' || !Number.isFinite(createdAtMs))) ||
        (status !== 'temporary' && status !== 'project-owned')
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

export function serializedBuffersEqual(
    alpha: PreparedSerializedAudioBuffer,
    beta: PreparedSerializedAudioBuffer
): boolean {
    return (
        alpha.sampleRate === beta.sampleRate &&
        alpha.numberOfChannels === beta.numberOfChannels &&
        alpha.sizeInBytes === beta.sizeInBytes &&
        alpha.channelData.length === beta.channelData.length &&
        alpha.channelData.every((channel, channelIndex) => {
            const other = beta.channelData[channelIndex];
            return (
                other !== undefined &&
                channel.length === other.length &&
                channel.every((sample, sampleIndex) => sample === other[sampleIndex])
            );
        })
    );
}

export function promotedOwner(owner: PreparedAudioBufferOwner, promotionRevision: string): PreparedAudioBufferOwner {
    return { ...owner, promotionRevision, status: 'project-owned' };
}

export function finalizedOwner(owner: PreparedAudioBufferOwner): PreparedAudioBufferOwner {
    const finalized: PreparedAudioBufferOwner = {
        schemaVersion: 1,
        leaseId: owner.leaseId,
        status: 'project-owned',
    };
    if (owner.createdAtMs !== undefined) {
        finalized.createdAtMs = owner.createdAtMs;
    }
    if (owner.persistenceRevision !== undefined) {
        finalized.persistenceRevision = owner.persistenceRevision;
    }
    return finalized;
}

export function requiresPromotionReconciliation(
    owner: PreparedAudioBufferOwner
): owner is PreparedAudioBufferOwner & { promotionRevision: string; status: 'project-owned' } {
    return owner.status === 'project-owned' && owner.promotionRevision !== undefined;
}

export function temporaryOwner(owner: PreparedAudioBufferOwner): PreparedAudioBufferOwner {
    const temporary: PreparedAudioBufferOwner = {
        schemaVersion: 1,
        leaseId: owner.leaseId,
        status: 'temporary',
    };
    if (owner.createdAtMs !== undefined) {
        temporary.createdAtMs = owner.createdAtMs;
    }
    if (owner.persistenceRevision !== undefined) {
        temporary.persistenceRevision = owner.persistenceRevision;
    }
    return temporary;
}
