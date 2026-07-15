import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

import { type DocId, type DocumentBundle } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';
import { saveAllToIdb } from '../repositories/crdtPersistence/saveAllToIdb';
import { saveIncrementalsToIdb } from '../repositories/crdtPersistence/saveIncrementalsToIdb';

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
const CRDT_PERSISTENCE_QUEUE_STATE_VERSION = 1;

type CrdtPersistenceQueueState = {
    version: number;
    persistenceGeneration: number;
    operationTail: Promise<void>;
    pendingChunks: PendingIncrementalChunk[];
    pendingFullSnapshot: PendingFullSnapshot | null;
    persistedBaseDocIds: Set<DocId>;
};

function createInitialPersistenceQueueState(): CrdtPersistenceQueueState {
    return {
        version: CRDT_PERSISTENCE_QUEUE_STATE_VERSION,
        persistenceGeneration: 0,
        operationTail: Promise.resolve(),
        pendingChunks: [],
        pendingFullSnapshot: null,
        persistedBaseDocIds: new Set<DocId>([DOC_PREFIX_ROOT]),
    };
}

const persistenceState = createHmrPersistentState<CrdtPersistenceQueueState>(
    CRDT_PERSISTENCE_QUEUE_STATE_KEY,
    createInitialPersistenceQueueState
);

if (persistenceState.version !== CRDT_PERSISTENCE_QUEUE_STATE_VERSION) {
    const previousGeneration =
        typeof persistenceState.persistenceGeneration === 'number' ? persistenceState.persistenceGeneration : 0;
    persistenceState.version = CRDT_PERSISTENCE_QUEUE_STATE_VERSION;
    persistenceState.persistenceGeneration = previousGeneration + 1;
    persistenceState.operationTail = Promise.resolve();
    persistenceState.pendingChunks = [];
    persistenceState.pendingFullSnapshot = null;
    persistenceState.persistedBaseDocIds = new Set<DocId>([DOC_PREFIX_ROOT]);
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
    crdtProjectCompactionState.incrementalSaveCount = 0;
}

function noOpPersistenceOperation(): Promise<void> {
    return Promise.resolve();
}

async function persistIncrementalCrdtProject(generation: number): Promise<void> {
    await flushPendingFullSnapshot(generation);
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

    persistenceState.pendingFullSnapshot = pending;
    try {
        await saveAllToIdb(pending.bundle);
    } catch (error: unknown) {
        if (pending.generation === persistenceState.persistenceGeneration) {
            persistenceState.pendingFullSnapshot = pending;
        }
        throw error;
    }

    if (
        pending.generation === persistenceState.persistenceGeneration &&
        persistenceState.pendingFullSnapshot === pending
    ) {
        persistenceState.pendingFullSnapshot = null;
        persistenceState.persistedBaseDocIds.clear();
        for (const id of pending.bundle.keys()) {
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
        await saveIncrementalsToIdb(
            chunks.map(({ id, chunk }) => ({
                id,
                chunk,
            }))
        );
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
    return automergeRepository.getDocIds().sort((alpha, bravo) => {
        if (alpha < bravo) {
            return -1;
        }
        if (alpha > bravo) {
            return 1;
        }
        return 0;
    });
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
