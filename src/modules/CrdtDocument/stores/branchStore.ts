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
 * What consuming the session backup actually achieved.
 *
 * Two independent steps can fail, and they have different consequences, so one
 * boolean cannot carry the answer honestly:
 *
 * - `restored` — the pre-session state is durable and the backup is gone.
 * - `state-not-persisted` — the write was refused. This session holds the
 *   pre-session state, a reload would not.
 * - `backup-not-cleared` — the state is durable, but the backup could not be
 *   removed, so it will be applied again at the next boot and pin the branch
 *   list to this snapshot until `invalidateStaleSessionBackup` clears it.
 */
export type BranchStateRestoreOutcome = 'restored' | 'state-not-persisted' | 'backup-not-cleared';

/**
 * The durable branch state as it stood when a restore failed to complete.
 *
 * `null` means nothing is pending. This cannot be read off the live adapter
 * later: `trySet` advances that adapter's cache whether or not the write
 * landed, so the cached value cannot answer "has a durable write happened
 * since?" — which is the only question that makes a retained backup stale.
 */
let durableStateAtRestoreFailure: BranchStoreState | null | undefined = undefined;
let disarmSessionBackupInvalidation: (() => void) | null = null;

/**
 * Read what `localStorage` actually holds, not what the live adapter is showing.
 * A fresh adapter starts with an empty cache, so its first `get()` is a durable
 * read by construction.
 */
function readDurableBranchState(): BranchStoreState | null {
    const durable = createLocalStorage<BranchStoreState>('sourdaw-branches').get();
    if (durable === null) {
        return null;
    }
    return validateStoredBranchStoreState(durable);
}

function isSameBranchState(left: BranchStoreState | null, right: BranchStoreState | null): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * A retained backup is a retry only while durable state has not moved on.
 *
 * The moment a `branchStore` write lands durably — the restore's own write
 * finally succeeding, or a branch the user creates afterwards — the backup
 * stops describing anything worth restoring and becomes a rollback: the next
 * boot would silently revert the branch list and orphan any `branch_<uuid>`
 * document created since, with nothing left to list it. So the backup is
 * dropped on the first durable write after the failure, and only then.
 */
function invalidateStaleSessionBackup(): void {
    if (durableStateAtRestoreFailure === undefined) {
        return;
    }

    if (isSameBranchState(readDurableBranchState(), durableStateAtRestoreFailure)) {
        // Nothing has reached the backing store since the failure. `set` cannot
        // advance the adapter cache without a durable write, so this is also the
        // state where a refused write leaves the store — the backup is still a
        // faithful retry and stays.
        return;
    }

    if (!branchSessionBackupStorage.trySet(null)) {
        // Still cannot remove it. Stay armed rather than claim it is gone.
        return;
    }

    durableStateAtRestoreFailure = undefined;
    disarmSessionBackupInvalidation?.();
    disarmSessionBackupInvalidation = null;
}

function armSessionBackupInvalidation(durableAtFailure: BranchStoreState | null): void {
    durableStateAtRestoreFailure = durableAtFailure;
    if (disarmSessionBackupInvalidation) {
        return;
    }
    disarmSessionBackupInvalidation = branchStore.subscribe(invalidateStaleSessionBackup);
}

/**
 * Stand the invalidation down for the duration of a collaboration session.
 *
 * The invalidation reads "the durable branch state moved" as "the user wrote a
 * branch", and inside a session that inference is wrong in the one way that
 * matters: the host's projected list is a durable write too, and it is the
 * exact write the backup exists to protect against. Left armed, joining a
 * session after a failed restore would let the projection eat the backup, and
 * leaving again would find nothing to restore and report `restored` — the
 * user's local-only branch gone from the store and the backup both, with
 * success reported and nothing said.
 *
 * `preserveBranchStateForSession` calls this, so the window is exactly the one
 * where a session owns the backup. If the restore at the end of the session
 * fails, it arms again on its way out. See #1557.
 */
export function suspendSessionBackupInvalidation(): void {
    durableStateAtRestoreFailure = undefined;
    disarmSessionBackupInvalidation?.();
    disarmSessionBackupInvalidation = null;
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
 * Neither step throws, and neither is allowed to report success it did not
 * achieve — see `BranchStateRestoreOutcome`.
 */
export function restoreBranchStateFromSessionBackup(): BranchStateRestoreOutcome {
    const backup = branchSessionBackupStorage.get();
    if (backup === null) {
        return 'restored';
    }

    const durableBeforeRestore = readDurableBranchState();

    if (!branchStore.trySet(validateStoredBranchStoreState(backup))) {
        armSessionBackupInvalidation(durableBeforeRestore);
        return 'state-not-persisted';
    }

    // Dropping the backup is a removal, which a full quota does not reject —
    // but an origin whose storage access is blocked refuses every
    // `localStorage` operation, and this runs from the composition root where a
    // throw is still the whole boot. The
    // result is not discardable: a backup that survives is applied again at the
    // next boot, so reporting this as a clean restore would pin the branch list
    // to the pre-session snapshot silently and permanently.
    if (!branchSessionBackupStorage.trySet(null)) {
        armSessionBackupInvalidation(durableBeforeRestore);
        return 'backup-not-cleared';
    }

    return 'restored';
}

export const branchStore = createStore<BranchStoreState>({
    storage: createLocalStorage<BranchStoreState>('sourdaw-branches'),
    initialData: createDefaultBranchStoreState(),
    sanitize: validateStoredBranchStoreState,
});
