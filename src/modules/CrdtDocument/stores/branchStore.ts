import { createStore } from '#/infra/store/createStore';

import { DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';
import { DEFAULT_CRDT_ROOT_LINEAGE, parseCrdtRootLineage } from '../models/CrdtRootLineage';

export type BranchRecord = {
    branchId: string;
    name: string;
    rootDocId: string;
    sourceBranchId: string | null;
    createdAt: number;
    createdFromHeads: string[];
    note: string;
};

export type BranchStoreState = {
    branches: BranchRecord[];
    activeBranchId: string;
};

export const MAIN_BRANCH_ID = DEFAULT_CRDT_ROOT_LINEAGE;
export const MAIN_BRANCH_DOC_ID = `branch_${MAIN_BRANCH_ID}`;

type UnknownRecord = {
    [key: string]: unknown;
};

export function createDefaultBranchStoreState(): BranchStoreState {
    return {
        branches: [
            {
                branchId: MAIN_BRANCH_ID,
                name: 'Main',
                rootDocId: DOC_PREFIX_ROOT,
                sourceBranchId: null,
                createdAt: Date.now(),
                createdFromHeads: [],
                note: '',
            },
        ],
        activeBranchId: MAIN_BRANCH_ID,
    };
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateStoredBranchRecord(value: unknown): BranchRecord | null {
    if (!isRecord(value)) {
        return null;
    }

    if (
        typeof value.name !== 'string' ||
        typeof value.rootDocId !== 'string' ||
        (value.sourceBranchId !== null && typeof value.sourceBranchId !== 'string') ||
        typeof value.createdAt !== 'number' ||
        !Number.isFinite(value.createdAt) ||
        !Array.isArray(value.createdFromHeads) ||
        typeof value.note !== 'string'
    ) {
        return null;
    }

    const branchId = parseCrdtRootLineage(value.branchId);
    const sourceBranchId = value.sourceBranchId === null ? null : parseCrdtRootLineage(value.sourceBranchId);
    if (!branchId || (value.sourceBranchId !== null && !sourceBranchId)) {
        return null;
    }

    if (branchId === MAIN_BRANCH_ID) {
        const hasValidMainBacking = value.rootDocId === DOC_PREFIX_ROOT || value.rootDocId === MAIN_BRANCH_DOC_ID;
        if (!hasValidMainBacking || value.sourceBranchId !== null) {
            return null;
        }
    }

    const createdFromHeads: string[] = [];
    for (const head of value.createdFromHeads) {
        if (typeof head !== 'string') {
            return null;
        }
        createdFromHeads.push(head);
    }

    return {
        branchId,
        name: value.name,
        rootDocId: value.rootDocId,
        sourceBranchId,
        createdAt: value.createdAt,
        createdFromHeads,
        note: value.note,
    };
}

function validateStoredBranchRecords(values: unknown[]): BranchRecord[] {
    const branches: BranchRecord[] = [];
    const seenBranchIds = new Set<string>();

    for (const value of values) {
        const branch = validateStoredBranchRecord(value);
        if (branch === null || seenBranchIds.has(branch.branchId)) {
            continue;
        }

        seenBranchIds.add(branch.branchId);
        branches.push(branch);
    }

    return branches;
}

export function validateStoredBranchStoreState(value: unknown): BranchStoreState {
    if (!isRecord(value)) {
        return createDefaultBranchStoreState();
    }

    const branches = Array.isArray(value.branches) ? validateStoredBranchRecords(value.branches) : [];
    const hasMainBranch = branches.some((branch) => branch.branchId === MAIN_BRANCH_ID);
    if (!hasMainBranch) {
        return createDefaultBranchStoreState();
    }

    let activeBranchId = MAIN_BRANCH_ID;
    if (
        typeof value.activeBranchId === 'string' &&
        branches.some((branch) => branch.branchId === value.activeBranchId)
    ) {
        activeBranchId = value.activeBranchId;
    }

    return { branches, activeBranchId };
}

/**
 * Validate a branch list that has to be distinguishable from an absent one.
 *
 * `validateStoredBranchStoreState` answers "what should the app show", so it
 * manufactures a default Main list for anything it cannot read. A durable
 * envelope and the legacy seed both need the other question answered — "is
 * there a branch list here at all" — because defaulting a malformed envelope
 * to Main would look exactly like a real single-branch project and would let a
 * corrupt read overwrite a good list at the next commit.
 */
export function readBranchStoreStateRecord(value: unknown): BranchStoreState | null {
    return isRecord(value) ? validateStoredBranchStoreState(value) : null;
}

/**
 * Memory only, deliberately.
 *
 * Durable branch state lives in one revisioned envelope owned by
 * `branchStateAuthority`, which writes it under a Web Lock and compares the
 * writer's observed revision before every write. A `localStorage` adapter here
 * would put a second, unsequenced writer on the same data — the shape that let
 * a retained collaboration-session backup overwrite a branch a later instance
 * had already committed (#4249). This store is the projection the UI reads; the
 * authority hydrates it.
 */
export const branchStore = createStore<BranchStoreState>({
    initialData: createDefaultBranchStoreState(),
});
