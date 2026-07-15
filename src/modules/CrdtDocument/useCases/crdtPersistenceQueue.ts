import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

import {
    createCrdtPersistenceMembershipConflictError,
    type CrdtPersistenceMembershipConflictError,
} from '../errors/CrdtPersistenceMembershipConflictError';
import { type DocId, type DocumentBundle } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';
import { loadPersistenceSnapshotFromIdb } from '../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb';
import {
    EMPTY_PERSISTENCE_AUTHORITY,
    type CrdtPersistenceAuthority,
} from '../repositories/crdtPersistence/persistenceAuthority';
import { saveAllToIdb } from '../repositories/crdtPersistence/saveAllToIdb';
import {
    saveIncrementalsToIdb,
    type SaveIncrementalsToIdbResult,
} from '../repositories/crdtPersistence/saveIncrementalsToIdb';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';
import { CRDT_PROJECT_COMPACTION_THRESHOLD, crdtProjectCompactionState } from './crdtProjectCompactionState';

type PendingIncrementalChunk = {
    generation: number;
    id: DocId;
    chunk: Uint8Array;
    inFlight: boolean;
};

type PendingFullSnapshot = {
    generation: number;
    bundle: DocumentBundle;
};

const CRDT_PERSISTENCE_QUEUE_STATE_KEY = 'crdtDocument.persistenceQueue';
const CRDT_PERSISTENCE_QUEUE_STATE_VERSION = 3;

type CrdtPersistenceQueueState = {
    version: number;
    persistenceGeneration: number;
    operationTail: Promise<void>;
    pendingChunks: PendingIncrementalChunk[];
    pendingFullSnapshot: PendingFullSnapshot | null;
    persistedBaseDocIds: Set<DocId>;
    authority: CrdtPersistenceAuthority | null;
    replacementEpoch: string | null;
    migrationReconciliationRequired: boolean;
    migrationMembershipConflict: CrdtPersistenceMembershipConflictError | null;
};

function createInitialPersistenceQueueState(): CrdtPersistenceQueueState {
    return {
        version: CRDT_PERSISTENCE_QUEUE_STATE_VERSION,
        persistenceGeneration: 0,
        operationTail: Promise.resolve(),
        pendingChunks: [],
        pendingFullSnapshot: null,
        persistedBaseDocIds: new Set<DocId>([DOC_PREFIX_ROOT]),
        authority: null,
        replacementEpoch: null,
        migrationReconciliationRequired: false,
        migrationMembershipConflict: null,
    };
}

const persistenceState = createHmrPersistentState<CrdtPersistenceQueueState>(
    CRDT_PERSISTENCE_QUEUE_STATE_KEY,
    createInitialPersistenceQueueState
);

if (persistenceState.version !== CRDT_PERSISTENCE_QUEUE_STATE_VERSION) {
    const previousOperationTail = getPreviousOperationTail(persistenceState);
    const previousGeneration =
        typeof persistenceState.persistenceGeneration === 'number' ? persistenceState.persistenceGeneration : 0;
    persistenceState.version = CRDT_PERSISTENCE_QUEUE_STATE_VERSION;
    persistenceState.persistenceGeneration = previousGeneration + 1;
    persistenceState.pendingChunks = [];
    persistenceState.pendingFullSnapshot = null;
    persistenceState.persistedBaseDocIds = new Set<DocId>([DOC_PREFIX_ROOT]);
    persistenceState.authority = null;
    persistenceState.replacementEpoch = null;
    persistenceState.migrationReconciliationRequired = true;
    persistenceState.migrationMembershipConflict = null;

    const migrationGeneration = persistenceState.persistenceGeneration;
    const migrationRecovery = previousOperationTail.then(async () => {
        await reconcileMigrationPersistenceSnapshot(migrationGeneration);
        return compactCrdtProject(migrationGeneration);
    });
    // Keep the tail usable after recovery failure. Snapshot reconciliation
    // remains required, while a failed full write retains its captured bytes.
    persistenceState.operationTail = migrationRecovery.then(
        () => undefined,
        () => undefined
    );
}

type CrdtPersistenceOperation = 'incremental' | 'compact' | 'reset';

/** Serialize persistence operations and reset private lifecycle state. */
export function runCrdtPersistenceOperation(operation: CrdtPersistenceOperation): Promise<void> {
    if (operation === 'reset') {
        resetQueueState();
        return Promise.resolve();
    }

    const generation = persistenceState.persistenceGeneration;
    const run = persistenceState.operationTail.then(() => {
        if (generation !== persistenceState.persistenceGeneration) {
            return noOpPersistenceOperation();
        }
        if (operation === 'compact') {
            return compactCrdtProject(generation);
        }
        return persistIncrementalCrdtProject(generation);
    });
    persistenceState.operationTail = run.then(
        () => undefined,
        () => undefined
    );
    return run;
}

/** Adopt the authority read with the project bundle that this realm loaded. */
export function setCrdtPersistenceAuthority(authority: CrdtPersistenceAuthority): void {
    persistenceState.authority = authority;
    persistenceState.replacementEpoch = null;
    persistenceState.migrationReconciliationRequired = false;
    persistenceState.migrationMembershipConflict = null;
}

function resetQueueState(): void {
    persistenceState.persistenceGeneration++;
    for (let index = persistenceState.pendingChunks.length - 1; index >= 0; index--) {
        const pending = persistenceState.pendingChunks[index];
        if (pending && !pending.inFlight) {
            persistenceState.pendingChunks.splice(index, 1);
        }
    }
    persistenceState.pendingFullSnapshot = null;
    persistenceState.persistedBaseDocIds.clear();
    persistenceState.persistedBaseDocIds.add(DOC_PREFIX_ROOT);
    // A project reset intentionally publishes a new epoch, but it still reads
    // and claims the current durable revision before replacing the bundle. A
    // concurrent realm can therefore never be cleared by an unseen reset.
    persistenceState.authority = null;
    persistenceState.replacementEpoch = crypto.randomUUID();
    persistenceState.migrationReconciliationRequired = false;
    persistenceState.migrationMembershipConflict = null;
    crdtProjectCompactionState.incrementalSaveCount = 0;
}

function noOpPersistenceOperation(): Promise<void> {
    return Promise.resolve();
}

async function ensurePersistenceAuthority(generation: number): Promise<CrdtPersistenceAuthority> {
    if (generation !== persistenceState.persistenceGeneration) {
        return EMPTY_PERSISTENCE_AUTHORITY;
    }
    if (persistenceState.migrationMembershipConflict) {
        throw persistenceState.migrationMembershipConflict;
    }
    if (persistenceState.migrationReconciliationRequired) {
        await reconcileMigrationPersistenceSnapshot(generation);
    }
    if (generation !== persistenceState.persistenceGeneration) {
        return EMPTY_PERSISTENCE_AUTHORITY;
    }
    if (persistenceState.authority) {
        return persistenceState.authority;
    }

    const snapshot = await loadPersistenceSnapshotFromIdb();
    if (generation !== persistenceState.persistenceGeneration) {
        return EMPTY_PERSISTENCE_AUTHORITY;
    }

    persistenceState.authority = snapshot?.authority ?? EMPTY_PERSISTENCE_AUTHORITY;
    return persistenceState.authority;
}

async function reconcileMigrationPersistenceSnapshot(generation: number): Promise<void> {
    if (generation !== persistenceState.persistenceGeneration) {
        return;
    }
    if (persistenceState.migrationMembershipConflict) {
        throw persistenceState.migrationMembershipConflict;
    }
    if (!persistenceState.migrationReconciliationRequired) {
        return;
    }

    const snapshot = await loadPersistenceSnapshotFromIdb();
    if (generation !== persistenceState.persistenceGeneration) {
        return;
    }

    const durableBundle = getMigrationDurableBundle(snapshot);
    if (durableBundle) {
        const membershipConflict = getPersistenceMembershipConflict(getActiveDocIds(), durableBundle);
        if (membershipConflict) {
            persistenceState.migrationMembershipConflict = membershipConflict;
            throw membershipConflict;
        }
        if (durableBundle.size > 0) {
            await automergeRepository.mergeBundle(durableBundle, {
                shouldCommit: () => shouldCommitMigrationReconciliation(generation),
            });
            if (!shouldCommitMigrationReconciliation(generation)) {
                return;
            }
        }
    }

    persistenceState.authority = snapshot?.authority ?? EMPTY_PERSISTENCE_AUTHORITY;
    persistenceState.migrationReconciliationRequired = false;
}

function shouldCommitMigrationReconciliation(generation: number): boolean {
    return (
        generation === persistenceState.persistenceGeneration &&
        persistenceState.migrationReconciliationRequired &&
        persistenceState.migrationMembershipConflict === null
    );
}

function getMigrationDurableBundle(
    snapshot: Awaited<ReturnType<typeof loadPersistenceSnapshotFromIdb>>
): DocumentBundle | null {
    if (snapshot?.bundle) {
        return snapshot.bundle;
    }
    if (
        snapshot &&
        (snapshot.authority.epoch !== EMPTY_PERSISTENCE_AUTHORITY.epoch ||
            snapshot.authority.revision !== EMPTY_PERSISTENCE_AUTHORITY.revision)
    ) {
        return new Map<DocId, Uint8Array>();
    }
    return null;
}

function assertSamePersistenceEpoch(expected: CrdtPersistenceAuthority, actual: CrdtPersistenceAuthority): void {
    if (expected.epoch !== actual.epoch) {
        throw new Error('[CrdtPersistence] Project authority changed; reload is required before saving');
    }
}

function getSortedDocumentIds(documentIds: Iterable<DocId>): DocId[] {
    return [...documentIds].sort((alpha, bravo) => {
        if (alpha < bravo) {
            return -1;
        }
        if (alpha > bravo) {
            return 1;
        }
        return 0;
    });
}

function getDurableDocumentIds(bundle: DocumentBundle): DocId[] {
    return getSortedDocumentIds([...bundle.keys()].filter((id) => !id.includes(':incremental:')));
}

function getPersistenceMembershipConflict(
    localDocumentIds: Iterable<DocId>,
    durableBundle: DocumentBundle
): CrdtPersistenceMembershipConflictError | null {
    const localIds = getSortedDocumentIds(localDocumentIds);
    const durableIds = getDurableDocumentIds(durableBundle);
    if (localIds.length === durableIds.length && localIds.every((id, index) => id === durableIds[index])) {
        return null;
    }

    return createCrdtPersistenceMembershipConflictError({
        localDocumentIds: localIds,
        durableDocumentIds: durableIds,
    });
}

function assertSamePersistenceMembership(localDocumentIds: Iterable<DocId>, durableBundle: DocumentBundle): void {
    const conflict = getPersistenceMembershipConflict(localDocumentIds, durableBundle);
    if (conflict) {
        throw conflict;
    }
}

function getPreviousOperationTail(state: unknown): Promise<void> {
    if (typeof state !== 'object' || state === null || !('operationTail' in state)) {
        return Promise.resolve();
    }

    const operationTail = state.operationTail;
    if (!isPromiseLike(operationTail)) {
        return Promise.resolve();
    }

    return Promise.resolve(operationTail).then(
        () => undefined,
        () => undefined
    );
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    if (typeof value !== 'object' || value === null || !('then' in value)) {
        return false;
    }
    return typeof value.then === 'function';
}

async function persistIncrementalCrdtProject(generation: number): Promise<void> {
    await flushPendingFullSnapshot(generation);
    await ensurePersistenceAuthority(generation);
    await flushPendingChunks(generation);
    if (generation !== persistenceState.persistenceGeneration) {
        return;
    }

    const activeDocIds = getActiveDocIds();
    if (activeDocIds.length === 0) {
        if (persistenceState.persistedBaseDocIds.size > 0) {
            await compactCrdtProject(generation);
        }
        return;
    }

    // Incremental records require a full base record for their document. A
    // newly created or removed document changes the persisted shape, so write
    // one current full bundle before advancing any new incremental cursor.
    if (hasPersistedDocumentShapeChanged(activeDocIds)) {
        await compactCrdtProject(generation);
        return;
    }

    for (const id of activeDocIds) {
        const chunk = automergeRepository.saveDocIncremental(id);
        if (!chunk || chunk.length === 0) {
            continue;
        }

        persistenceState.pendingChunks.push({
            generation,
            id,
            chunk: new Uint8Array(chunk),
            inFlight: false,
        });
    }

    await flushPendingChunks(generation);
    if (generation !== persistenceState.persistenceGeneration) {
        return;
    }

    if (crdtProjectCompactionState.incrementalSaveCount >= CRDT_PROJECT_COMPACTION_THRESHOLD) {
        await compactCrdtProject(generation);
    }
}

async function compactCrdtProject(generation: number): Promise<void> {
    flushAutomergeStorageWrites();
    await flushPendingChunks(generation);
    if (generation !== persistenceState.persistenceGeneration) {
        return;
    }

    // A failed full save may have advanced Automerge's incremental cursor, so
    // retry its captured bytes before any later incremental serialization.
    const failedSnapshot =
        persistenceState.pendingFullSnapshot?.generation === generation ? persistenceState.pendingFullSnapshot : null;
    await flushPendingFullSnapshot(generation);
    if (generation !== persistenceState.persistenceGeneration) {
        return;
    }

    if (failedSnapshot) {
        const currentBundle = automergeRepository.saveAll();
        if (areDocumentBundlesEqual(failedSnapshot.bundle, currentBundle)) {
            return;
        }

        await persistFullSnapshot({
            generation,
            bundle: currentBundle,
        });
        return;
    }

    await persistFullSnapshot({
        generation,
        bundle: automergeRepository.saveAll(),
    });
}

async function flushPendingFullSnapshot(generation: number): Promise<void> {
    const pending = persistenceState.pendingFullSnapshot;
    if (!pending || pending.generation !== generation) {
        return;
    }

    if (!hasSameDocumentIds(pending.bundle, getActiveDocIds())) {
        // An obsolete full bundle can contain a document removed since the
        // failed attempt. Supersede it before retrying so a crash cannot leave
        // the deleted document as the latest durable state.
        persistenceState.pendingFullSnapshot = null;
        return;
    }

    await persistFullSnapshot(pending);
}

/** Keep a serialized full bundle pending until its replace transaction commits. */
async function persistFullSnapshot(pending: PendingFullSnapshot): Promise<void> {
    if (pending.generation !== persistenceState.persistenceGeneration) {
        return;
    }

    let currentPending = pending;
    persistenceState.pendingFullSnapshot = currentPending;

    try {
        while (currentPending.generation === persistenceState.persistenceGeneration) {
            const expectedAuthority = await ensurePersistenceAuthority(currentPending.generation);
            if (currentPending.generation !== persistenceState.persistenceGeneration) {
                return;
            }
            const result = await saveAllToIdb(currentPending.bundle, {
                expectedAuthority,
                nextEpoch: persistenceState.replacementEpoch ?? expectedAuthority.epoch,
            });
            if (currentPending.generation !== persistenceState.persistenceGeneration) {
                return;
            }

            if (result.status === 'committed') {
                persistenceState.authority = result.authority;
                persistenceState.replacementEpoch = null;
                break;
            }

            assertSamePersistenceEpoch(expectedAuthority, result.authority);
            assertSamePersistenceMembership(getActiveDocIds(), result.bundle);
            await automergeRepository.mergeBundle(result.bundle, {
                shouldCommit: () => currentPending.generation === persistenceState.persistenceGeneration,
            });
            if (currentPending.generation !== persistenceState.persistenceGeneration) {
                return;
            }
            const mergedBundle = automergeRepository.saveAll();
            persistenceState.authority = result.authority;
            currentPending = {
                ...currentPending,
                bundle: mergedBundle,
            };
            persistenceState.pendingFullSnapshot = currentPending;
        }
    } catch (error: unknown) {
        if (pending.generation === persistenceState.persistenceGeneration) {
            persistenceState.pendingFullSnapshot = currentPending;
        }
        throw error;
    }

    if (
        currentPending.generation === persistenceState.persistenceGeneration &&
        persistenceState.pendingFullSnapshot === currentPending
    ) {
        persistenceState.pendingFullSnapshot = null;
        persistenceState.persistedBaseDocIds.clear();
        for (const id of currentPending.bundle.keys()) {
            persistenceState.persistedBaseDocIds.add(id);
        }
        crdtProjectCompactionState.incrementalSaveCount = 0;
    }
}

function areDocumentBundlesEqual(left: DocumentBundle, right: DocumentBundle): boolean {
    if (left.size !== right.size) {
        return false;
    }

    for (const [id, leftBytes] of left) {
        const rightBytes = right.get(id);
        if (!rightBytes || leftBytes.length !== rightBytes.length) {
            return false;
        }
        for (let index = 0; index < leftBytes.length; index++) {
            if (leftBytes[index] !== rightBytes[index]) {
                return false;
            }
        }
    }

    return true;
}

async function flushPendingChunks(generation: number): Promise<void> {
    prunePendingChunks(generation);
    const chunks = persistenceState.pendingChunks.filter(
        (pending) => pending.generation === generation && !pending.inFlight
    );
    if (chunks.length === 0) {
        return;
    }

    for (const pending of chunks) {
        pending.inFlight = true;
    }

    try {
        while (generation === persistenceState.persistenceGeneration) {
            const expectedAuthority = await ensurePersistenceAuthority(generation);
            if (generation !== persistenceState.persistenceGeneration) {
                return;
            }
            const result: SaveIncrementalsToIdbResult = await saveIncrementalsToIdb(
                chunks.map(({ id, chunk }) => ({
                    id,
                    chunk,
                })),
                { expectedAuthority }
            );
            if (generation !== persistenceState.persistenceGeneration) {
                return;
            }

            if (result.status === 'committed') {
                persistenceState.authority = result.authority;
                break;
            }

            const conflictResult: Extract<SaveIncrementalsToIdbResult, { status: 'conflict' }> = result;
            assertSamePersistenceEpoch(expectedAuthority, conflictResult.authority);
            const localDocumentIds = new Set(getActiveDocIds());
            for (const { id } of chunks) {
                localDocumentIds.add(id);
            }
            assertSamePersistenceMembership(localDocumentIds, conflictResult.bundle);
            await automergeRepository.mergeBundle(conflictResult.bundle, {
                shouldCommit: () => generation === persistenceState.persistenceGeneration,
            });
            if (generation !== persistenceState.persistenceGeneration) {
                return;
            }
            persistenceState.authority = conflictResult.authority;
        }
    } finally {
        for (const pending of chunks) {
            pending.inFlight = false;
            if (pending.generation !== persistenceState.persistenceGeneration) {
                removePendingChunk(pending);
            }
        }
    }

    if (generation !== persistenceState.persistenceGeneration) {
        return;
    }

    for (const pending of chunks) {
        removePendingChunk(pending);
    }
    // Every chunk in the atomic transaction is non-empty and committed here.
    crdtProjectCompactionState.incrementalSaveCount += chunks.length;
}

function prunePendingChunks(generation: number): void {
    const activeDocIds = new Set(automergeRepository.getDocIds());
    for (let index = persistenceState.pendingChunks.length - 1; index >= 0; index--) {
        const pending = persistenceState.pendingChunks[index];
        if (pending && pending.generation === generation && !pending.inFlight && !activeDocIds.has(pending.id)) {
            persistenceState.pendingChunks.splice(index, 1);
        }
    }
}

function getActiveDocIds(): DocId[] {
    return getSortedDocumentIds(automergeRepository.getDocIds());
}

function hasPersistedDocumentShapeChanged(activeDocIds: DocId[]): boolean {
    if (activeDocIds.length !== persistenceState.persistedBaseDocIds.size) {
        return true;
    }

    return activeDocIds.some((id) => !persistenceState.persistedBaseDocIds.has(id));
}

function hasSameDocumentIds(bundle: DocumentBundle, docIds: DocId[]): boolean {
    if (bundle.size !== docIds.length) {
        return false;
    }

    return docIds.every((id) => bundle.has(id));
}

function removePendingChunk(pending: PendingIncrementalChunk): void {
    const index = persistenceState.pendingChunks.indexOf(pending);
    if (index >= 0) {
        persistenceState.pendingChunks.splice(index, 1);
    }
}
