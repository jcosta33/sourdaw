import { requireCheckpointIdentity } from './requireCheckpointIdentity';

type CheckpointArtifactEntry = {
    checkpointId: string;
    ownerProjectId: string;
    rootBytes: Uint8Array;
};

function requireRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('[CheckpointPersistence] artifact entry must be a record');
    }
    return value as Record<string, unknown>;
}

function isUint8Array(value: unknown): value is Uint8Array {
    return Object.prototype.toString.call(value) === '[object Uint8Array]';
}

function copyRootBytes(value: unknown): Uint8Array {
    if (!isUint8Array(value) || value.byteLength === 0) {
        throw new Error('[CheckpointPersistence] rootBytes must be a non-empty Uint8Array');
    }
    return Uint8Array.from(value);
}

export function parseCheckpointArtifactEntry(value: unknown): CheckpointArtifactEntry {
    const record = requireRecord(value);
    return {
        checkpointId: requireCheckpointIdentity(record.checkpointId, 'checkpointId'),
        ownerProjectId: requireCheckpointIdentity(record.ownerProjectId, 'ownerProjectId'),
        rootBytes: copyRootBytes(record.rootBytes),
    };
}
