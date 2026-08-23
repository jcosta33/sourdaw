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

export type PreparedAudioBufferRecoveryMetadata = {
    id: string;
    metadata: PreparedAudioBufferMetadata;
    operation: 'discard' | 'reclamation';
    revision: string;
    schemaVersion: 1;
};

export type PreparedAudioBufferRecoveryRecord = PreparedAudioBufferRecoveryMetadata & {
    data: PreparedSerializedAudioBuffer;
    stagedAtMs: number;
};

/** Legacy v2 key format, retained only to migrate recovery rows out of ordinary stores. */
export const PREPARED_AUDIO_RECOVERY_KEY_PREFIX = '\u0000sourdaw-prepared-recovery:';

export function preparedAudioRecoveryKey(id: string): string {
    return `${PREPARED_AUDIO_RECOVERY_KEY_PREFIX}${id}`;
}

export function isPreparedAudioRecoveryKey(id: string): boolean {
    return id.startsWith(PREPARED_AUDIO_RECOVERY_KEY_PREFIX);
}

export function readPreparedAudioRecoveryMetadata(value: unknown): PreparedAudioBufferRecoveryMetadata | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const candidate = value as Record<string, unknown>;
    if (
        candidate.schemaVersion !== 1 ||
        typeof candidate.id !== 'string' ||
        candidate.id.trim().length === 0 ||
        typeof candidate.revision !== 'string' ||
        candidate.revision.trim().length === 0 ||
        (candidate.operation !== 'discard' && candidate.operation !== 'reclamation') ||
        candidate.metadata === null ||
        typeof candidate.metadata !== 'object' ||
        Array.isArray(candidate.metadata)
    ) {
        return null;
    }
    return candidate as PreparedAudioBufferRecoveryMetadata;
}

export function readPreparedAudioRecoveryRecord(value: unknown): PreparedAudioBufferRecoveryRecord | null {
    const recovery = readPreparedAudioRecoveryMetadata(value);
    if (
        recovery === null ||
        !('data' in recovery) ||
        !('stagedAtMs' in recovery) ||
        typeof recovery.stagedAtMs !== 'number' ||
        !Number.isFinite(recovery.stagedAtMs) ||
        !isValidPreparedAudioBufferPair(recovery.data, recovery.metadata)
    ) {
        return null;
    }
    return recovery as PreparedAudioBufferRecoveryRecord;
}

function isFloat32Array(value: unknown): value is Float32Array {
    return Object.prototype.toString.call(value) === '[object Float32Array]';
}

export function isValidPreparedSerializedAudioBuffer(data: unknown): data is PreparedSerializedAudioBuffer {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return false;
    }
    const candidate = data as Record<string, unknown>;
    const channelData = candidate.channelData;
    if (!Array.isArray(channelData) || !channelData.every(isFloat32Array)) {
        return false;
    }
    const length = channelData[0]?.length ?? 0;
    const sizeInBytes = channelData.reduce((total, channel) => total + channel.byteLength, 0);
    return (
        typeof candidate.sampleRate === 'number' &&
        Number.isFinite(candidate.sampleRate) &&
        candidate.sampleRate > 0 &&
        typeof candidate.numberOfChannels === 'number' &&
        Number.isInteger(candidate.numberOfChannels) &&
        candidate.numberOfChannels > 0 &&
        length > 0 &&
        channelData.length === candidate.numberOfChannels &&
        channelData.every((channel) => channel.length === length) &&
        typeof candidate.lastAccessed === 'number' &&
        Number.isFinite(candidate.lastAccessed) &&
        candidate.sizeInBytes === sizeInBytes
    );
}

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

export function isValidPreparedAudioBufferPair(
    data: unknown,
    metadata: unknown
): data is PreparedSerializedAudioBuffer {
    if (
        !isValidPreparedSerializedAudioBuffer(data) ||
        metadata === null ||
        typeof metadata !== 'object' ||
        Array.isArray(metadata)
    ) {
        return false;
    }
    const candidate = metadata as Record<string, unknown>;
    const owner = readPreparedOwner(metadata);
    return (
        owner !== null &&
        owner !== 'invalid' &&
        typeof candidate.lastAccessed === 'number' &&
        Number.isFinite(candidate.lastAccessed) &&
        candidate.sizeInBytes === data.sizeInBytes &&
        (candidate.freezeProjectId === undefined ||
            (typeof candidate.freezeProjectId === 'number' &&
                Number.isSafeInteger(candidate.freezeProjectId) &&
                candidate.freezeProjectId >= 0))
    );
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
