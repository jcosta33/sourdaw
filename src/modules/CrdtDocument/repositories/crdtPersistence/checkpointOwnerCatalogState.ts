import { type CheckpointCatalogEntry } from '../../models/CheckpointArtifact';

import { parseCheckpointCatalogEntry } from './parseCheckpointCatalogEntry';
import { requireCheckpointIdentity } from './requireCheckpointIdentity';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export type CheckpointBranch = {
    id: string;
    name: string;
    createdAt: string;
    headCheckpointId: string | null;
};

export type CheckpointOwnerState = {
    ownerProjectId: string;
    catalogRevision: string;
    branches: CheckpointBranch[];
    currentBranchId: string;
    currentCheckpointId: string | null;
};

export type CheckpointOwnerStateInput = Omit<CheckpointOwnerState, 'ownerProjectId' | 'catalogRevision'>;

export type CheckpointCatalogSnapshot = CheckpointOwnerState & {
    checkpoints: CheckpointCatalogEntry[];
};

function requireRecord(value: unknown, name: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`[CheckpointPersistence] ${name} must be a record`);
    }
    return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string, allowEmpty = false): string {
    if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
        throw new Error(`[CheckpointPersistence] ${name} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`);
    }
    return value;
}

function requireIsoDate(value: unknown, name: string): string {
    const date = requireString(value, name);
    if (!ISO_DATE_PATTERN.test(date) || Number.isNaN(Date.parse(date))) {
        throw new Error(`[CheckpointPersistence] ${name} must be an ISO date-time string`);
    }
    return date;
}

function requireNullableCheckpointId(value: unknown, name: string): string | null {
    return value === null ? null : requireCheckpointIdentity(value, name);
}

function parseBranch(value: unknown, index: number): CheckpointBranch {
    const record = requireRecord(value, `branches[${index}]`);
    return {
        id: requireCheckpointIdentity(record.id, `branches[${index}].id`),
        name: requireString(record.name, `branches[${index}].name`, true),
        createdAt: requireIsoDate(record.createdAt, `branches[${index}].createdAt`),
        headCheckpointId: requireNullableCheckpointId(record.headCheckpointId, `branches[${index}].headCheckpointId`),
    };
}

function parseBranches(value: unknown): CheckpointBranch[] {
    if (!Array.isArray(value)) {
        throw new TypeError('[CheckpointPersistence] branches must be an array');
    }
    const branches: CheckpointBranch[] = [];
    const ids = new Set<string>();
    for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) {
            throw new Error('[CheckpointPersistence] branches must be dense');
        }
        const branch = parseBranch(value[index], index);
        if (ids.has(branch.id)) {
            throw new Error(`[CheckpointPersistence] duplicate branch ID ${branch.id}`);
        }
        ids.add(branch.id);
        branches.push(branch);
    }
    return branches;
}

function parseCheckpointOwnerStateInput(value: unknown): CheckpointOwnerStateInput {
    const record = requireRecord(value, 'nextState');
    return {
        branches: parseBranches(record.branches),
        currentBranchId: requireCheckpointIdentity(record.currentBranchId, 'currentBranchId'),
        currentCheckpointId: requireNullableCheckpointId(record.currentCheckpointId, 'currentCheckpointId'),
    };
}

function parseCheckpointOwnerState(value: unknown, expectedOwnerProjectId: string): CheckpointOwnerState {
    const record = requireRecord(value, 'owner catalog');
    const ownerProjectId = requireCheckpointIdentity(record.ownerProjectId, 'ownerProjectId');
    if (ownerProjectId !== expectedOwnerProjectId) {
        throw new Error('[CheckpointPersistence] Owner catalog key mismatch');
    }
    return {
        ownerProjectId,
        catalogRevision: requireCheckpointIdentity(record.catalogRevision, 'catalogRevision'),
        branches: parseBranches(record.branches),
        currentBranchId: requireCheckpointIdentity(record.currentBranchId, 'currentBranchId'),
        currentCheckpointId: requireNullableCheckpointId(record.currentCheckpointId, 'currentCheckpointId'),
    };
}

function compareCatalogEntries(left: CheckpointCatalogEntry, right: CheckpointCatalogEntry): number {
    const createdAtOrder = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (createdAtOrder !== 0) {
        return createdAtOrder;
    }
    return left.checkpointId.localeCompare(right.checkpointId);
}

function parseOwnerCheckpointMetadata(
    values: readonly unknown[],
    keys: readonly IDBValidKey[],
    ownerProjectId: string
): CheckpointCatalogEntry[] {
    if (values.length !== keys.length) {
        throw new Error('[CheckpointPersistence] Catalog key/value result mismatch');
    }
    const entries = values.map((value, index) => {
        const checkpointId = requireCheckpointIdentity(keys[index], 'catalog checkpoint key');
        const entry = parseCheckpointCatalogEntry(value);
        if (entry.checkpointId !== checkpointId || entry.ownerProjectId !== ownerProjectId) {
            throw new Error('[CheckpointPersistence] Stored checkpoint catalog identity mismatch');
        }
        return entry;
    });
    return entries.toSorted(compareCatalogEntries);
}

function parseOwnerArtifactKeys(keys: readonly IDBValidKey[]): string[] {
    return keys.map((key) => requireCheckpointIdentity(key, 'artifact checkpoint key')).toSorted();
}

function validateCheckpointPairs(checkpoints: readonly CheckpointCatalogEntry[], artifactIds: readonly string[]): void {
    const descriptorIds = checkpoints.map(({ checkpointId }) => checkpointId).toSorted();
    const sortedArtifactIds = [...artifactIds].toSorted();
    if (
        descriptorIds.length !== sortedArtifactIds.length ||
        descriptorIds.some((checkpointId, index) => checkpointId !== sortedArtifactIds[index])
    ) {
        throw new Error('[CheckpointPersistence] Stored checkpoint pair is incomplete');
    }
}

function validateCheckpointOwnerGraph(
    state: CheckpointOwnerStateInput | CheckpointOwnerState,
    checkpoints: readonly CheckpointCatalogEntry[]
): void {
    const branchIds = new Set(state.branches.map(({ id }) => id));
    if (!branchIds.has(state.currentBranchId)) {
        throw new Error('[CheckpointPersistence] currentBranchId does not identify a branch');
    }

    const checkpointById = new Map(checkpoints.map((checkpoint) => [checkpoint.checkpointId, checkpoint]));
    const requireCheckpoint = (checkpointId: string | null, name: string): void => {
        if (checkpointId !== null && !checkpointById.has(checkpointId)) {
            throw new Error(`[CheckpointPersistence] ${name} is not owned by this catalog`);
        }
    };
    requireCheckpoint(state.currentCheckpointId, 'currentCheckpointId');
    for (const branch of state.branches) {
        requireCheckpoint(branch.headCheckpointId, `branch ${branch.id} headCheckpointId`);
    }

    for (const checkpoint of checkpoints) {
        if (checkpoint.parentId === checkpoint.checkpointId) {
            throw new Error(`[CheckpointPersistence] checkpoint ${checkpoint.checkpointId} cannot parent itself`);
        }
        requireCheckpoint(checkpoint.parentId, `checkpoint ${checkpoint.checkpointId} parentId`);
    }

    for (const checkpoint of checkpoints) {
        const visited = new Set<string>();
        let current: CheckpointCatalogEntry | undefined = checkpoint;
        while (current !== undefined && current.parentId !== null) {
            if (visited.has(current.checkpointId)) {
                throw new Error('[CheckpointPersistence] checkpoint parent cycle detected');
            }
            visited.add(current.checkpointId);
            current = checkpointById.get(current.parentId);
        }
    }
}

function detachedCheckpointCatalogSnapshot(
    state: CheckpointOwnerState,
    checkpoints: readonly CheckpointCatalogEntry[]
): CheckpointCatalogSnapshot {
    return {
        ownerProjectId: state.ownerProjectId,
        catalogRevision: state.catalogRevision,
        branches: state.branches.map((branch) => ({ ...branch })),
        currentBranchId: state.currentBranchId,
        currentCheckpointId: state.currentCheckpointId,
        checkpoints: checkpoints.map((checkpoint) => ({
            ...checkpoint,
            tags: [...checkpoint.tags],
            audioBufferIds: [...checkpoint.audioBufferIds],
        })),
    };
}

export const checkpointOwnerCatalogState = {
    detachedSnapshot: detachedCheckpointCatalogSnapshot,
    parseArtifactKeys: parseOwnerArtifactKeys,
    parseCheckpointMetadata: parseOwnerCheckpointMetadata,
    parseInput: parseCheckpointOwnerStateInput,
    parseStored: parseCheckpointOwnerState,
    validateGraph: validateCheckpointOwnerGraph,
    validatePairs: validateCheckpointPairs,
};
