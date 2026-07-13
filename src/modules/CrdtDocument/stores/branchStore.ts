import { createStore } from '#/infra/store/createStore';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

import { DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';

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

export const MAIN_BRANCH_ID = 'main';

type UnknownRecord = {
    [key: string]: unknown;
};

function createDefaultBranchStoreState(): BranchStoreState {
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
        typeof value.branchId !== 'string' ||
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

    if (value.branchId === MAIN_BRANCH_ID && (value.rootDocId !== DOC_PREFIX_ROOT || value.sourceBranchId !== null)) {
        return null;
    }

    const createdFromHeads: string[] = [];
    for (const head of value.createdFromHeads) {
        if (typeof head !== 'string') {
            return null;
        }
        createdFromHeads.push(head);
    }

    return {
        branchId: value.branchId,
        name: value.name,
        rootDocId: value.rootDocId,
        sourceBranchId: value.sourceBranchId,
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

export const branchStore = createStore<BranchStoreState>({
    storage: createLocalStorage<BranchStoreState>('sourdaw-branches'),
    initialData: createDefaultBranchStoreState(),
    sanitize: validateStoredBranchStoreState,
});
