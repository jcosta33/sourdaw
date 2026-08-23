export type PreparedAudioBufferOwner = {
    schemaVersion: 1;
    createdAtMs?: number;
    leaseId: string;
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

export function readPreparedOwner(
    metadata: PreparedAudioBufferMetadata | undefined
): PreparedAudioBufferOwner | null | 'invalid' {
    const owner = metadata?.preparedOwner;
    if (owner === undefined) {
        return null;
    }
    if (
        owner === null ||
        typeof owner !== 'object' ||
        owner.schemaVersion !== 1 ||
        typeof owner.leaseId !== 'string' ||
        owner.leaseId.trim().length === 0 ||
        (owner.promotionRevision !== undefined && owner.promotionRevision.trim().length === 0) ||
        (owner.status === 'temporary' && owner.promotionRevision !== undefined) ||
        (owner.createdAtMs !== undefined && !Number.isFinite(owner.createdAtMs)) ||
        (owner.status !== 'temporary' && owner.status !== 'project-owned')
    ) {
        return 'invalid';
    }
    return owner;
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

export function temporaryOwner(owner: PreparedAudioBufferOwner): PreparedAudioBufferOwner {
    const temporary: PreparedAudioBufferOwner = {
        schemaVersion: 1,
        leaseId: owner.leaseId,
        status: 'temporary',
    };
    if (owner.createdAtMs !== undefined) {
        temporary.createdAtMs = owner.createdAtMs;
    }
    return temporary;
}
