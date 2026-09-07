import { type CheckpointCatalogEntry } from '../../models/CheckpointArtifact';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function requireRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('[CheckpointPersistence] catalog entry must be a record');
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
        throw new TypeError(`[CheckpointPersistence] ${name} must be an array`);
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

export function parseCheckpointCatalogEntry(value: unknown): CheckpointCatalogEntry {
    const record = requireRecord(value);
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
