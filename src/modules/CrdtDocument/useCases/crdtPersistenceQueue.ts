import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';

import { type DocId } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';
import { saveAllToIdb } from '../repositories/crdtPersistence/saveAllToIdb';
import { saveIncrementalToIdb } from '../repositories/crdtPersistence/saveIncrementalToIdb';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';
import { CRDT_PROJECT_COMPACTION_THRESHOLD, crdtProjectCompactionState } from './crdtProjectCompactionState';

type PendingIncrementalChunk = {
    generation: number;
    id: DocId;
    chunk: Uint8Array;
    inFlight: boolean;
};

let persistenceGeneration = 0;
let operationTail: Promise<void> = Promise.resolve();
let pendingChunks: PendingIncrementalChunk[] = [];

type CrdtPersistenceOperation = 'incremental' | 'compact' | 'reset';

/** Serialize persistence operations and reset private lifecycle state. */
export function runCrdtPersistenceOperation(operation: CrdtPersistenceOperation): Promise<void> {
    if (operation === 'reset') {
        resetQueueState();
        return Promise.resolve();
    }

    const generation = persistenceGeneration;
    const run = operationTail.then(() => {
        if (generation !== persistenceGeneration) {
            return noOpPersistenceOperation();
        }
        if (operation === 'compact') {
            return compactCrdtProject(generation);
        }
        return persistIncrementalCrdtProject(generation);
    });
    operationTail = run.then(
        () => undefined,
        () => undefined
    );
    return run;
}

function resetQueueState(): void {
    persistenceGeneration++;
    pendingChunks = pendingChunks.filter((pending) => pending.inFlight);
    crdtProjectCompactionState.incrementalSaveCount = 0;
}

function noOpPersistenceOperation(): Promise<void> {
    return Promise.resolve();
}

async function persistIncrementalCrdtProject(generation: number): Promise<void> {
    await flushPendingChunks(generation);
    if (generation !== persistenceGeneration) {
        return;
    }

    const chunk = automergeRepository.saveDocIncremental(DOC_PREFIX_ROOT);
    if (chunk && chunk.length > 0) {
        const pending: PendingIncrementalChunk = {
            generation,
            id: DOC_PREFIX_ROOT,
            chunk: new Uint8Array(chunk),
            inFlight: false,
        };
        pendingChunks.push(pending);
        await persistPendingChunk(pending);

        if (generation === persistenceGeneration) {
            crdtProjectCompactionState.incrementalSaveCount++;
        }
    }

    if (crdtProjectCompactionState.incrementalSaveCount >= CRDT_PROJECT_COMPACTION_THRESHOLD) {
        await compactCrdtProject(generation);
    }
}

async function compactCrdtProject(generation: number): Promise<void> {
    flushAutomergeStorageWrites();
    await flushPendingChunks(generation);
    if (generation !== persistenceGeneration) {
        return;
    }

    const bundle = automergeRepository.saveAll();
    await saveAllToIdb(bundle);
    if (generation === persistenceGeneration) {
        crdtProjectCompactionState.incrementalSaveCount = 0;
    }
}

async function flushPendingChunks(generation: number): Promise<void> {
    const chunks = pendingChunks.filter((pending) => pending.generation === generation);
    for (const pending of chunks) {
        if (generation !== persistenceGeneration) {
            return;
        }
        await persistPendingChunk(pending);
        if (generation === persistenceGeneration) {
            crdtProjectCompactionState.incrementalSaveCount++;
        }
    }
}

async function persistPendingChunk(pending: PendingIncrementalChunk): Promise<void> {
    pending.inFlight = true;
    try {
        await saveIncrementalToIdb(pending.id, pending.chunk);
        removePendingChunk(pending);
    } finally {
        pending.inFlight = false;
        if (pending.generation !== persistenceGeneration) {
            removePendingChunk(pending);
        }
    }
}

function removePendingChunk(pending: PendingIncrementalChunk): void {
    pendingChunks = pendingChunks.filter((candidate) => candidate !== pending);
}
