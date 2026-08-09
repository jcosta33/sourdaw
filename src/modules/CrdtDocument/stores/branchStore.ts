import { createStore } from '#/infra/store/createStore';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

import { DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';
import { DEFAULT_CRDT_ROOT_LINEAGE, parseCrdtRootLineage } from '../models/CrdtRootLineage';

import { branchSessionBackupStorage } from './branchSessionBackupStorage';

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
 * Put the durable pre-session branch state back, discarding whatever a
 * collaboration session projected over it.
 *
 * Not a module-evaluation side effect — it used to be, and that made a full
 * origin quota fatal to the whole app: the write threw while `branchStore.ts`
 * was still evaluating, so every importer across CrdtDocument, Collaboration
 * and Project failed to initialise and no catch in the app could reach it,
 * because the failure happened before any app code ran. The composition root
 * calls this through `initBranchState` instead (see #1557).
 *
 * Returns whether the restored state is durable. When it is not, the backup is
 * deliberately left in place: the session already holds the restored value, and
 * keeping the backup is what lets a later boot — or a later `stopBranchSync` —
 * try again rather than lose the pre-session state to one refused write.
 */
export function restoreBranchStateFromSessionBackup(): boolean {
    const backup = branchSessionBackupStorage.get();
    if (backup === null) {
        return true;
    }

    const persisted = branchStore.trySet(validateStoredBranchStoreState(backup));
    if (!persisted) {
        return false;
    }

    // Dropping the backup is a removal, which a full quota does not reject —
    // but this now runs from the composition root, where any throw is still the
    // whole boot, and the backup is already superseded by the state above.
    branchSessionBackupStorage.trySet(null);
    return true;
}

export const branchStore = createStore<BranchStoreState>({
    storage: createLocalStorage<BranchStoreState>('sourdaw-branches'),
    initialData: createDefaultBranchStoreState(),
    sanitize: validateStoredBranchStoreState,
});
