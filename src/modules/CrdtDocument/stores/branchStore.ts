import { createStore } from '#/infra/store/createStore';
import { createLocalStorage, type LocalStorageAdapter } from '#/infra/store/storage/createLocalStorage';

import { DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';
import { DEFAULT_CRDT_ROOT_LINEAGE, parseCrdtRootLineage } from '../models/CrdtRootLineage';

import { branchSessionBackupStorage, readDurableBranchSessionBackup } from './branchSessionBackupStorage';

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
 * - `storage-unavailable` — durable storage could not be read, so neither the
 *   backup nor the state it would replace was treated as authoritative.
 */
export type BranchStateRestoreOutcome =
    'restored' | 'state-not-persisted' | 'backup-not-cleared' | 'storage-unavailable';

type DurableBranchStateRead = { status: 'read'; value: BranchStoreState | null } | { status: 'storage-unavailable' };

type DurableSessionBackupRead = { status: 'read'; value: unknown } | { status: 'storage-unavailable' };

type DurableBranchSnapshot = { status: 'known'; value: string | null } | { status: 'unknown' };

type SessionBackupInvalidationAuthority = {
    generation: number;
    snapshot: DurableBranchSnapshot;
};

/**
 * The durable branch state as it stood when a restore failed to complete.
 *
 * This cannot be read off the live adapter later: `trySet` advances that
 * adapter's cache whether or not the write landed. The branch-local adapter
 * records only successful durable writes and its first successful backing-store
 * read, so a refused write cannot manufacture authority to discard the backup.
 */
let durableStateAtRestoreFailure: SessionBackupInvalidationAuthority | undefined = undefined;
let durableBranchGeneration = 0;
let durableBranchSnapshot: DurableBranchSnapshot = { status: 'unknown' };
let suppressRestoreWriteInvalidation = false;

/**
 * Read what `localStorage` actually holds, not what the live adapter is showing.
 * A fresh adapter starts with an empty cache, so its first `get()` is a durable
 * read by construction.
 */
function readDurableBranchState(): DurableBranchStateRead {
    try {
        const durable = createLocalStorage<BranchStoreState>('sourdaw-branches').get();
        return {
            status: 'read',
            value: durable === null ? null : validateStoredBranchStoreState(durable),
        };
    } catch {
        return { status: 'storage-unavailable' };
    }
}

function readDurableSessionBackup(): DurableSessionBackupRead {
    try {
        return { status: 'read', value: readDurableBranchSessionBackup() };
    } catch {
        return { status: 'storage-unavailable' };
    }
}

function snapshotBranchState(value: BranchStoreState | null): string | null {
    return value === null ? null : JSON.stringify(validateStoredBranchStoreState(value));
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
function removeStaleSessionBackup(): boolean {
    if (!branchSessionBackupStorage.trySet(null)) {
        return false;
    }

    clearSessionBackupInvalidation();
    return true;
}

function invalidateSessionBackupAfterDurableWrite(): void {
    if (
        suppressRestoreWriteInvalidation ||
        durableStateAtRestoreFailure === undefined ||
        durableBranchGeneration <= durableStateAtRestoreFailure.generation
    ) {
        return;
    }

    removeStaleSessionBackup();
}

function clearSessionBackupInvalidation(): void {
    durableStateAtRestoreFailure = undefined;
}

function armSessionBackupInvalidation(durableAtFailure: DurableBranchStateRead): void {
    if (durableStateAtRestoreFailure !== undefined) {
        return;
    }

    let snapshot = durableBranchSnapshot;
    if (durableAtFailure.status === 'read') {
        snapshot = { status: 'known', value: snapshotBranchState(durableAtFailure.value) };
    }
    durableStateAtRestoreFailure = { generation: durableBranchGeneration, snapshot };
}

function armSessionBackupAfterRestoredWrite(restoredState: BranchStoreState): void {
    durableStateAtRestoreFailure = {
        generation: durableBranchGeneration,
        snapshot: { status: 'known', value: snapshotBranchState(restoredState) },
    };
}

function retainedBackupIsStale(durableNow: DurableBranchStateRead): 'stale' | 'current' | 'storage-unavailable' {
    const retained = durableStateAtRestoreFailure;
    if (retained === undefined) {
        return 'current';
    }
    if (durableBranchGeneration > retained.generation) {
        return 'stale';
    }
    if (durableNow.status === 'storage-unavailable' || retained.snapshot.status === 'unknown') {
        return 'storage-unavailable';
    }
    return snapshotBranchState(durableNow.value) === retained.snapshot.value ? 'current' : 'stale';
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
    clearSessionBackupInvalidation();
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
    const backup = readDurableSessionBackup();
    if (backup.status === 'storage-unavailable') {
        armSessionBackupInvalidation(readDurableBranchState());
        return 'storage-unavailable';
    }
    if (backup.value === null) {
        clearSessionBackupInvalidation();
        return 'restored';
    }

    const durableBeforeRestore = readDurableBranchState();
    if (durableBeforeRestore.status === 'storage-unavailable') {
        armSessionBackupInvalidation(durableBeforeRestore);
        return 'storage-unavailable';
    }

    const retainedStatus = retainedBackupIsStale(durableBeforeRestore);
    if (retainedStatus === 'storage-unavailable') {
        return 'storage-unavailable';
    }
    if (retainedStatus === 'stale') {
        removeStaleSessionBackup();
        const retainedBackup = readDurableSessionBackup();
        if (retainedBackup.status === 'storage-unavailable') {
            return 'storage-unavailable';
        }
        return retainedBackup.value === null ? 'restored' : 'backup-not-cleared';
    }

    const restoredState = validateStoredBranchStoreState(backup.value);
    let statePersisted: boolean;
    suppressRestoreWriteInvalidation = true;
    try {
        statePersisted = branchStore.trySet(restoredState);
    } finally {
        suppressRestoreWriteInvalidation = false;
    }
    if (!statePersisted) {
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
        armSessionBackupAfterRestoredWrite(restoredState);
        return 'backup-not-cleared';
    }

    clearSessionBackupInvalidation();
    return 'restored';
}

const baseBranchStorage = createLocalStorage<BranchStoreState>('sourdaw-branches');
let firstDurableBranchReadRecorded = false;

function recordDurableBranchState(value: BranchStoreState | null, write: boolean): void {
    if (write) {
        durableBranchGeneration += 1;
    }
    durableBranchSnapshot = { status: 'known', value: snapshotBranchState(value) };
}

const branchStorage: LocalStorageAdapter<BranchStoreState> = {
    get(): BranchStoreState | null {
        const value = baseBranchStorage.get();
        if (!firstDurableBranchReadRecorded) {
            firstDurableBranchReadRecorded = true;
            recordDurableBranchState(value, false);
        }
        return value;
    },
    set(value): void {
        baseBranchStorage.set(value);
        recordDurableBranchState(value, true);
        invalidateSessionBackupAfterDurableWrite();
    },
    trySet(value): boolean {
        const persisted = baseBranchStorage.trySet(value);
        if (persisted) {
            recordDurableBranchState(value, true);
            invalidateSessionBackupAfterDurableWrite();
        }
        return persisted;
    },
    clear(): void {
        baseBranchStorage.clear();
        recordDurableBranchState(null, true);
        invalidateSessionBackupAfterDurableWrite();
    },
    isSupported(): boolean {
        return baseBranchStorage.isSupported();
    },
};

export const branchStore = createStore<BranchStoreState>({
    storage: branchStorage,
    initialData: createDefaultBranchStoreState(),
    sanitize: validateStoredBranchStoreState,
});
