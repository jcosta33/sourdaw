export type CheckpointCatalogEntry = {
    checkpointId: string;
    ownerProjectId: string;
    label: string;
    description: string;
    tags: string[];
    createdAt: string;
    parentId: string | null;
    audioBufferIds: string[];
    ownershipToken: string;
};

export type CheckpointArtifactEntry = {
    checkpointId: string;
    ownerProjectId: string;
    rootBytes: Uint8Array;
};

export type CheckpointArtifactRecord = CheckpointCatalogEntry & {
    rootBytes: Uint8Array;
};

export type DeletedCheckpointArtifactOwnership = {
    checkpointId: string;
    projectOwnerId: string;
    ownershipToken: string;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function requireRecord(value: unknown, name: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`[CheckpointPersistence] ${name} must be a record`);
    }
    return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string, allowEmpty = true): string {
    if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
        throw new Error(`[CheckpointPersistence] ${name} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`);
    }
    return value;
}

function requireStringArray(value: unknown, name: string, allowEmptyItems: boolean): string[] {
    if (!Array.isArray(value)) {
        throw new Error(`[CheckpointPersistence] ${name} must be an array`);
    }

    const result: string[] = [];
    for (let index = 0; index < value.length; index++) {
        if (!(index in value)) {
            throw new Error(`[CheckpointPersistence] ${name} must be dense`);
        }
        result.push(requireString(value[index], `${name}[${index}]`, allowEmptyItems));
    }
    return result;
}

function requireCreatedAt(value: unknown): string {
    const createdAt = requireString(value, 'createdAt', false);
    if (!ISO_DATE_PATTERN.test(createdAt) || Number.isNaN(Date.parse(createdAt))) {
        throw new Error('[CheckpointPersistence] createdAt must be an ISO date-time string');
    }
    return createdAt;
}

function requireParentId(value: unknown): string | null {
    if (value === null) {
        return null;
    }
    return requireString(value, 'parentId', false);
}

function isUint8Array(value: unknown): value is Uint8Array {
    return Object.prototype.toString.call(value) === '[object Uint8Array]';
}

function requireRootBytes(value: unknown): Uint8Array {
    if (!isUint8Array(value)) {
        throw new Error('[CheckpointPersistence] rootBytes must be a non-empty Uint8Array');
    }
    if (value.byteLength === 0) {
        throw new Error('[CheckpointPersistence] rootBytes must be a non-empty Uint8Array');
    }
    return Uint8Array.from(value);
}

export function parseCheckpointCatalogEntry(value: unknown): CheckpointCatalogEntry {
    const record = requireRecord(value, 'catalog entry');
    return {
        checkpointId: requireString(record.checkpointId, 'checkpointId', false),
        ownerProjectId: requireString(record.ownerProjectId, 'ownerProjectId', false),
        label: requireString(record.label, 'label'),
        description: requireString(record.description, 'description'),
        tags: requireStringArray(record.tags, 'tags', true),
        createdAt: requireCreatedAt(record.createdAt),
        parentId: requireParentId(record.parentId),
        audioBufferIds: [...new Set(requireStringArray(record.audioBufferIds, 'audioBufferIds', false))].sort(),
        ownershipToken: requireString(record.ownershipToken, 'ownershipToken', false),
    };
}

export function parseCheckpointArtifactEntry(value: unknown): CheckpointArtifactEntry {
    const record = requireRecord(value, 'artifact entry');
    return {
        checkpointId: requireString(record.checkpointId, 'checkpointId', false),
        ownerProjectId: requireString(record.ownerProjectId, 'ownerProjectId', false),
        rootBytes: requireRootBytes(record.rootBytes),
    };
}

export function normalizeCheckpointArtifactRecord(value: unknown): CheckpointArtifactRecord {
    const record = requireRecord(value, 'checkpoint');
    return {
        ...parseCheckpointCatalogEntry(record),
        rootBytes: requireRootBytes(record.rootBytes),
    };
}

export function requireCheckpointIdentity(value: unknown, name: string): string {
    return requireString(value, name, false);
}

export function combineCheckpointPair(artifactValue: unknown, catalogValue: unknown): CheckpointArtifactRecord | null {
    const artifactMissing = artifactValue === undefined;
    const catalogMissing = catalogValue === undefined;
    if (artifactMissing && catalogMissing) {
        return null;
    }
    if (artifactMissing || catalogMissing) {
        throw new Error('[CheckpointPersistence] Stored checkpoint pair is incomplete');
    }

    const artifact = parseCheckpointArtifactEntry(artifactValue);
    const catalog = parseCheckpointCatalogEntry(catalogValue);
    if (artifact.checkpointId !== catalog.checkpointId || artifact.ownerProjectId !== catalog.ownerProjectId) {
        throw new Error('[CheckpointPersistence] Stored checkpoint pair identity mismatch');
    }

    return { ...catalog, rootBytes: artifact.rootBytes };
}
