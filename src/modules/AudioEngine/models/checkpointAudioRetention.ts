import { isValidSerializedAudioBuffer, type SerializedAudioBuffer } from './serializedAudioBuffer';

export const CHECKPOINT_RETENTION_STORE_NAME = 'checkpointRetentions';
export const CHECKPOINT_AUDIO_VERSION_STORE_NAME = 'checkpointAudioVersions';
export const CHECKPOINT_AUDIO_VERSION_META_STORE_NAME = 'checkpointAudioVersionMeta';

export type CheckpointAudioVersionMetadata = {
    schemaVersion: 1;
    versionKey: string;
    bufferId: string;
    persistenceRevision: string;
    sizeInBytes: number;
};

export type CheckpointAudioRetention = {
    schemaVersion: 2;
    checkpointId: string;
    projectOwnerId: string;
    ownershipToken: string;
    versionKeys: string[];
};

export function isNonEmptyAudioStorageId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

export function checkpointAudioVersionKey(bufferId: string, persistenceRevision: string): string {
    if (!isNonEmptyAudioStorageId(bufferId) || !isNonEmptyAudioStorageId(persistenceRevision)) {
        throw new Error('Checkpoint audio version requires non-empty buffer and persistence revision IDs.');
    }
    return JSON.stringify([bufferId, persistenceRevision]);
}

export function readCheckpointAudioVersionKey(key: unknown): readonly [string, string] | null {
    if (typeof key !== 'string') {
        return null;
    }
    let decoded: unknown;
    try {
        decoded = JSON.parse(key);
    } catch {
        return null;
    }
    if (
        !Array.isArray(decoded) ||
        decoded.length !== 2 ||
        !isNonEmptyAudioStorageId(decoded[0]) ||
        !isNonEmptyAudioStorageId(decoded[1]) ||
        JSON.stringify(decoded) !== key
    ) {
        return null;
    }
    return [decoded[0], decoded[1]];
}

function isDenseNonEmptyStringArray(values: readonly unknown[]): values is readonly string[] {
    for (let index = 0; index < values.length; index++) {
        if (!Object.hasOwn(values, index) || !isNonEmptyAudioStorageId(values[index])) {
            return false;
        }
    }
    return true;
}

export function canonicalAudioBufferIds(bufferIds: readonly unknown[]): string[] {
    if (!isDenseNonEmptyStringArray(bufferIds)) {
        throw new Error('Checkpoint audio retention requires non-empty buffer IDs.');
    }
    return [...new Set(bufferIds)].toSorted();
}

export function readCheckpointAudioRetention(value: unknown, key: IDBValidKey): CheckpointAudioRetention | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || typeof key !== 'string') {
        return null;
    }
    const candidate = value as Record<string, unknown>;
    const versionKeys: unknown = candidate.versionKeys;
    if (
        candidate.schemaVersion !== 2 ||
        candidate.checkpointId !== key ||
        !isNonEmptyAudioStorageId(candidate.checkpointId) ||
        !isNonEmptyAudioStorageId(candidate.projectOwnerId) ||
        !isNonEmptyAudioStorageId(candidate.ownershipToken) ||
        !Array.isArray(versionKeys) ||
        !isDenseNonEmptyStringArray(versionKeys)
    ) {
        return null;
    }
    const stringVersionKeys: string[] = [];
    for (const versionKey of versionKeys) {
        if (typeof versionKey !== 'string') {
            return null;
        }
        stringVersionKeys.push(versionKey);
    }
    const canonicalKeys = [...new Set(stringVersionKeys)].toSorted();
    if (
        canonicalKeys.length !== versionKeys.length ||
        canonicalKeys.some((versionKey, index) => versionKey !== versionKeys[index])
    ) {
        return null;
    }
    const bufferIds = new Set<string>();
    for (const versionKey of canonicalKeys) {
        const identity = readCheckpointAudioVersionKey(versionKey);
        if (identity === null || bufferIds.has(identity[0])) {
            return null;
        }
        bufferIds.add(identity[0]);
    }
    return {
        schemaVersion: 2,
        checkpointId: candidate.checkpointId,
        projectOwnerId: candidate.projectOwnerId,
        ownershipToken: candidate.ownershipToken,
        versionKeys: canonicalKeys,
    };
}

export function readCheckpointAudioVersionMetadata(
    value: unknown,
    key: IDBValidKey
): CheckpointAudioVersionMetadata | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || typeof key !== 'string') {
        return null;
    }
    const identity = readCheckpointAudioVersionKey(key);
    if (identity === null) {
        return null;
    }
    const candidate = value as Record<string, unknown>;
    if (
        candidate.schemaVersion !== 1 ||
        candidate.versionKey !== key ||
        candidate.bufferId !== identity[0] ||
        candidate.persistenceRevision !== identity[1] ||
        typeof candidate.sizeInBytes !== 'number' ||
        !Number.isSafeInteger(candidate.sizeInBytes) ||
        candidate.sizeInBytes <= 0
    ) {
        return null;
    }
    return {
        schemaVersion: 1,
        versionKey: key,
        bufferId: identity[0],
        persistenceRevision: identity[1],
        sizeInBytes: candidate.sizeInBytes,
    };
}

export function readCheckpointAudioVersion(
    value: unknown,
    metadata: CheckpointAudioVersionMetadata
): SerializedAudioBuffer | null {
    if (!isValidSerializedAudioBuffer(value) || value.sizeInBytes !== metadata.sizeInBytes) {
        return null;
    }
    return value;
}
