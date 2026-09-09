import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    installTransactionalIndexedDb,
    type TransactionalIndexedDbInstallation,
} from '#/infra/testing/installTransactionalIndexedDb';

import type { CheckpointArtifactRecord } from '../../../models/CheckpointArtifact';

const ownerA = 'project-a';
const ownerB = 'project-b';

type Repository = Awaited<ReturnType<typeof repositories>>;

function checkpoint(
    checkpointId: string,
    ownerProjectId = ownerA,
    overrides: Partial<CheckpointArtifactRecord> = {}
): CheckpointArtifactRecord {
    return {
        checkpointId,
        ownerProjectId,
        label: `Checkpoint ${checkpointId}`,
        description: 'Before tempo edit',
        tags: ['manual'],
        createdAt: '2026-09-05T10:00:00.000Z',
        parentId: null,
        audioBufferIds: ['buffer-b', 'buffer-a', 'buffer-b'],
        ownershipToken: `token-${checkpointId}`,
        rootBytes: new Uint8Array([1, 2, 3]),
        ...overrides,
    };
}

function branch(id: string, headCheckpointId: string | null = null, name = `Branch ${id}`) {
    return { id, name, createdAt: '2026-09-05T09:00:00.000Z', headCheckpointId };
}

function nextState(branches = [branch('main')], currentBranchId = 'main', currentCheckpointId: string | null = null) {
    return { branches, currentBranchId, currentCheckpointId };
}

async function repositories() {
    const [commitModule, readCatalogModule, readArtifactModule, helpers] = await Promise.all([
        import('../commitCheckpointCatalog'),
        import('../readCheckpointCatalog'),
        import('../readCheckpointArtifact'),
        import('../helpers'),
    ]);
    return {
        commitCheckpointCatalog: commitModule.commitCheckpointCatalog,
        readCheckpointCatalog: readCatalogModule.readCheckpointCatalog,
        readCheckpointArtifact: readArtifactModule.readCheckpointArtifact,
        ...helpers,
    };
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IDB transaction aborted'));
    });
}

function requestResult<TResult>(request: IDBRequest<TResult>): Promise<TResult> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
    });
}

async function writeStoredValue(repository: Repository, storeName: string, key: string, value: unknown): Promise<void> {
    const database = await repository.openDatabase();
    if (!database) {
        throw new Error('Expected IndexedDB');
    }
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value, key);
    await transactionDone(transaction);
}

async function deleteStoredValue(repository: Repository, storeName: string, key: string): Promise<void> {
    const database = await repository.openDatabase();
    if (!database) {
        throw new Error('Expected IndexedDB');
    }
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
}

async function readStoredValue(repository: Repository, storeName: string, key: string): Promise<unknown> {
    const database = await repository.openDatabase();
    if (!database) {
        throw new Error('Expected IndexedDB');
    }
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(key);
    const result = await requestResult(request);
    await transactionDone(transaction);
    return result;
}

async function createOwner(repository: Repository, ownerProjectId = ownerA) {
    return repository.commitCheckpointCatalog({
        ownerProjectId,
        expectedCatalogRevision: null,
        nextState: nextState(),
    });
}

describe('checkpoint owner catalog persistence', () => {
    let indexedDb: TransactionalIndexedDbInstallation | null = null;

    beforeEach(() => {
        indexedDb = installTransactionalIndexedDb();
        vi.resetModules();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        vi.resetModules();
        await indexedDb?.dispose();
        indexedDb = null;
    });

    it('publishes exact owner state and an optional artifact atomically, including an empty branch-only catalog', async () => {
        const repository = await repositories();
        await expect(repository.readCheckpointCatalog(ownerA)).resolves.toBeNull();

        const emptyCommit = await createOwner(repository);
        expect(emptyCommit).toEqual({ status: 'committed', catalogRevision: expect.any(String) });
        await expect(repository.readCheckpointCatalog(ownerA)).resolves.toEqual({
            ownerProjectId: ownerA,
            catalogRevision: emptyCommit.status === 'committed' ? emptyCommit.catalogRevision : '',
            ...nextState(),
            checkpoints: [],
        });

        const artifact = checkpoint('checkpoint-a');
        const committed = await repository.commitCheckpointCatalog({
            ownerProjectId: ownerA,
            expectedCatalogRevision: emptyCommit.status === 'committed' ? emptyCommit.catalogRevision : '',
            nextState: nextState([branch('main', artifact.checkpointId)], 'main', artifact.checkpointId),
            newArtifact: artifact,
        });
        expect(committed).toEqual({ status: 'committed', catalogRevision: expect.any(String) });
        await expect(repository.readCheckpointArtifact('checkpoint-a', ownerA)).resolves.toEqual({
            ...artifact,
            audioBufferIds: ['buffer-a', 'buffer-b'],
        });
        const { replaceAllInIdb } = await import('../replaceAllInIdb');
        await replaceAllInIdb(new Map([['document-a', new Uint8Array([9])]]));
        await expect(repository.readCheckpointArtifact('checkpoint-a', ownerA)).resolves.toMatchObject({
            checkpointId: 'checkpoint-a',
        });
    });

    it('captures caller input before the first await and returns detached nested data', async () => {
        const repository = await repositories();
        const artifact = checkpoint('checkpoint-a');
        const state = nextState([branch('main', 'checkpoint-a')], 'main', 'checkpoint-a');
        const committing = repository.commitCheckpointCatalog({
            ownerProjectId: ownerA,
            expectedCatalogRevision: null,
            nextState: state,
            newArtifact: artifact,
        });
        artifact.rootBytes[0] = 99;
        artifact.tags.push('mutated');
        artifact.audioBufferIds[0] = 'mutated-buffer';
        state.branches[0]!.name = 'mutated branch';

        await committing;
        const firstCatalog = await repository.readCheckpointCatalog(ownerA);
        const firstArtifact = await repository.readCheckpointArtifact('checkpoint-a', ownerA);
        expect(firstCatalog?.branches[0]?.name).toBe('Branch main');
        expect(firstCatalog?.checkpoints[0]?.tags).toEqual(['manual']);
        expect(firstArtifact?.rootBytes).toEqual(new Uint8Array([1, 2, 3]));

        firstCatalog!.branches[0]!.name = 'output mutation';
        firstCatalog!.checkpoints[0]!.tags.push('output mutation');
        firstArtifact!.rootBytes[0] = 77;
        await expect(repository.readCheckpointCatalog(ownerA)).resolves.toMatchObject({
            branches: [{ name: 'Branch main' }],
            checkpoints: [{ tags: ['manual'] }],
        });
        await expect(repository.readCheckpointArtifact('checkpoint-a', ownerA)).resolves.toMatchObject({
            rootBytes: new Uint8Array([1, 2, 3]),
        });
    });

    it('aborts all three stores after artifact and descriptor request success when owner publication aborts', async () => {
        const repository = await repositories();
        const initial = await createOwner(repository);
        if (initial.status !== 'committed') {
            throw new Error('Expected initial commit');
        }
        const database = await repository.openDatabase();
        if (!database) {
            throw new Error('Expected IndexedDB');
        }
        const objectStorePrototype = Object.getPrototypeOf(
            database
                .transaction(repository.CHECKPOINT_OWNER_CATALOG_STORE_NAME)
                .objectStore(repository.CHECKPOINT_OWNER_CATALOG_STORE_NAME)
        ) as IDBObjectStore;
        const originalAdd = objectStorePrototype.add;
        const originalPut = objectStorePrototype.put;
        const successfulAdds: string[] = [];
        vi.spyOn(objectStorePrototype, 'add').mockImplementation(function (
            this: IDBObjectStore,
            ...args: Parameters<IDBObjectStore['add']>
        ) {
            const request = originalAdd.apply(this, args);
            if (
                this.name === repository.CHECKPOINT_ARTIFACT_STORE_NAME ||
                this.name === repository.CHECKPOINT_CATALOG_STORE_NAME
            ) {
                const storeName = this.name;
                request.addEventListener('success', () => successfulAdds.push(storeName), { once: true });
            }
            return request;
        });
        let abortOwnerPut = true;
        vi.spyOn(objectStorePrototype, 'put').mockImplementation(function (
            this: IDBObjectStore,
            ...args: Parameters<IDBObjectStore['put']>
        ) {
            const request = originalPut.apply(this, args);
            if (abortOwnerPut && this.name === repository.CHECKPOINT_OWNER_CATALOG_STORE_NAME) {
                abortOwnerPut = false;
                const transaction = this.transaction;
                request.addEventListener('success', () => transaction.abort(), { once: true });
            }
            return request;
        });

        const artifact = checkpoint('aborted');
        await expect(
            repository.commitCheckpointCatalog({
                ownerProjectId: ownerA,
                expectedCatalogRevision: initial.catalogRevision,
                nextState: nextState([branch('main', artifact.checkpointId)], 'main', artifact.checkpointId),
                newArtifact: artifact,
            })
        ).rejects.toThrow(/aborted/i);
        expect(successfulAdds).toEqual(
            expect.arrayContaining([
                repository.CHECKPOINT_ARTIFACT_STORE_NAME,
                repository.CHECKPOINT_CATALOG_STORE_NAME,
            ])
        );
        expect(
            await readStoredValue(repository, repository.CHECKPOINT_ARTIFACT_STORE_NAME, artifact.checkpointId)
        ).toBeUndefined();
        expect(
            await readStoredValue(repository, repository.CHECKPOINT_CATALOG_STORE_NAME, artifact.checkpointId)
        ).toBeUndefined();
        await expect(repository.readCheckpointCatalog(ownerA)).resolves.toMatchObject({
            catalogRevision: initial.catalogRevision,
            checkpoints: [],
        });
    });

    it('serializes two independent connection writers with one CAS winner and no stale artifact', async () => {
        const first = await repositories();
        const initial = await createOwner(first);
        if (initial.status !== 'committed') {
            throw new Error('Expected initial commit');
        }
        const firstConnection = await first.openDatabase();
        vi.resetModules();
        const second = await repositories();
        const secondConnection = await second.openDatabase();
        expect(firstConnection).not.toBe(secondConnection);

        const alpha = checkpoint('alpha');
        const beta = checkpoint('beta');
        const [alphaResult, betaResult] = await Promise.all([
            first.commitCheckpointCatalog({
                ownerProjectId: ownerA,
                expectedCatalogRevision: initial.catalogRevision,
                nextState: nextState([branch('main', alpha.checkpointId)], 'main', alpha.checkpointId),
                newArtifact: alpha,
            }),
            second.commitCheckpointCatalog({
                ownerProjectId: ownerA,
                expectedCatalogRevision: initial.catalogRevision,
                nextState: nextState([branch('main', beta.checkpointId)], 'main', beta.checkpointId),
                newArtifact: beta,
            }),
        ]);
        expect([alphaResult.status, betaResult.status].toSorted()).toEqual(['committed', 'conflict']);
        const winner = alphaResult.status === 'committed' ? alpha : beta;
        const loser = winner === alpha ? beta : alpha;

        await expect(
            first.commitCheckpointCatalog({
                ownerProjectId: ownerA,
                expectedCatalogRevision: initial.catalogRevision,
                nextState: nextState([branch('main', loser.checkpointId)], 'main', loser.checkpointId),
                newArtifact: loser,
            })
        ).resolves.toEqual({ status: 'conflict' });
        vi.resetModules();
        const reopened = await repositories();
        await expect(reopened.readCheckpointCatalog(ownerA)).resolves.toMatchObject({
            currentCheckpointId: winner.checkpointId,
            checkpoints: [{ checkpointId: winner.checkpointId }],
        });
        await expect(reopened.readCheckpointArtifact(loser.checkpointId, ownerA)).resolves.toBeNull();
    });

    it('rejects invalid ownership, graph references and duplicate global checkpoint IDs without changing state', async () => {
        const repository = await repositories();
        const first = checkpoint('first');
        const initial = await repository.commitCheckpointCatalog({
            ownerProjectId: ownerA,
            expectedCatalogRevision: null,
            nextState: nextState([branch('main', 'first')], 'main', 'first'),
            newArtifact: first,
        });
        if (initial.status !== 'committed') {
            throw new Error('Expected initial commit');
        }
        const attempts = [
            () =>
                repository.commitCheckpointCatalog({
                    ownerProjectId: ownerA,
                    expectedCatalogRevision: initial.catalogRevision,
                    nextState: nextState(),
                    newArtifact: checkpoint('wrong-owner', ownerB),
                }),
            () =>
                repository.commitCheckpointCatalog({
                    ownerProjectId: ownerA,
                    expectedCatalogRevision: initial.catalogRevision,
                    nextState: nextState([branch('main')], 'missing'),
                }),
            () =>
                repository.commitCheckpointCatalog({
                    ownerProjectId: ownerA,
                    expectedCatalogRevision: initial.catalogRevision,
                    nextState: nextState([branch('main', 'missing')]),
                }),
            () =>
                repository.commitCheckpointCatalog({
                    ownerProjectId: ownerA,
                    expectedCatalogRevision: initial.catalogRevision,
                    nextState: nextState([branch('main')], 'main', 'missing'),
                }),
            () =>
                repository.commitCheckpointCatalog({
                    ownerProjectId: ownerA,
                    expectedCatalogRevision: initial.catalogRevision,
                    nextState: nextState([branch('main'), branch('main')]),
                }),
            () =>
                repository.commitCheckpointCatalog({
                    ownerProjectId: ownerA,
                    expectedCatalogRevision: initial.catalogRevision,
                    nextState: nextState([{ ...branch('main'), createdAt: 'not-an-iso-date' }]),
                }),
            () =>
                repository.commitCheckpointCatalog({
                    ownerProjectId: ownerA,
                    expectedCatalogRevision: initial.catalogRevision,
                    nextState: nextState(),
                    newArtifact: checkpoint('empty-root', ownerA, { rootBytes: new Uint8Array() }),
                }),
            () =>
                repository.commitCheckpointCatalog({
                    ownerProjectId: ownerA,
                    expectedCatalogRevision: initial.catalogRevision,
                    nextState: nextState(),
                    newArtifact: checkpoint('bad-artifact-date', ownerA, { createdAt: 'not-an-iso-date' }),
                }),
            () =>
                repository.commitCheckpointCatalog({
                    ownerProjectId: ownerA,
                    expectedCatalogRevision: initial.catalogRevision,
                    nextState: nextState([branch('main', 'dangling-parent')], 'main', 'dangling-parent'),
                    newArtifact: checkpoint('dangling-parent', ownerA, { parentId: 'missing-parent' }),
                }),
            () =>
                repository.commitCheckpointCatalog({
                    ownerProjectId: ownerA,
                    expectedCatalogRevision: initial.catalogRevision,
                    nextState: nextState([branch('main', 'self')], 'main', 'self'),
                    newArtifact: checkpoint('self', ownerA, { parentId: 'self' }),
                }),
            () =>
                repository.commitCheckpointCatalog({
                    ownerProjectId: ownerB,
                    expectedCatalogRevision: null,
                    nextState: nextState([branch('main', 'first')], 'main', 'first'),
                    newArtifact: checkpoint('first', ownerB),
                }),
        ];
        for (const attempt of attempts) {
            await expect(attempt()).rejects.toBeDefined();
        }
        await expect(repository.readCheckpointCatalog(ownerA)).resolves.toMatchObject({
            catalogRevision: initial.catalogRevision,
            checkpoints: [{ checkpointId: 'first' }],
        });

        const second = checkpoint('second', ownerA, { parentId: 'first' });
        const positive = await repository.commitCheckpointCatalog({
            ownerProjectId: ownerA,
            expectedCatalogRevision: initial.catalogRevision,
            nextState: nextState(
                [branch('main', 'first', 'Same name'), branch('alternate', 'second', 'Same name')],
                'alternate',
                'first'
            ),
            newArtifact: second,
        });
        expect(positive.status).toBe('committed');
    });

    it('rejects owner corruption and cycles while isolating corruption indexed to another owner', async () => {
        const repository = await repositories();
        const ownerACommit = await createOwner(repository, ownerA);
        expect(ownerACommit.status).toBe('committed');
        const ownerBCatalogA = checkpoint('owner-b-a', ownerB, { parentId: 'owner-b-b' });
        const ownerBCatalogB = checkpoint('owner-b-b', ownerB, { parentId: 'owner-b-a' });
        for (const artifact of [ownerBCatalogA, ownerBCatalogB]) {
            const { rootBytes, ...catalog } = artifact;
            await writeStoredValue(repository, repository.CHECKPOINT_ARTIFACT_STORE_NAME, artifact.checkpointId, {
                checkpointId: artifact.checkpointId,
                ownerProjectId: ownerB,
                rootBytes,
            });
            await writeStoredValue(
                repository,
                repository.CHECKPOINT_CATALOG_STORE_NAME,
                artifact.checkpointId,
                catalog
            );
        }
        await writeStoredValue(repository, repository.CHECKPOINT_OWNER_CATALOG_STORE_NAME, ownerB, {
            ownerProjectId: ownerB,
            catalogRevision: 'owner-b-revision',
            ...nextState([branch('main', 'owner-b-a')], 'main', 'owner-b-a'),
        });

        await expect(repository.readCheckpointCatalog(ownerA)).resolves.toMatchObject({ ownerProjectId: ownerA });
        await expect(repository.readCheckpointCatalog(ownerB)).rejects.toThrow(/cycle/);
    });

    it('hydrates owner-filtered metadata without reading any artifact values or value cursors', async () => {
        const repository = await repositories();
        const artifact = checkpoint('checkpoint-a');
        await repository.commitCheckpointCatalog({
            ownerProjectId: ownerA,
            expectedCatalogRevision: null,
            nextState: nextState([branch('main', artifact.checkpointId)], 'main', artifact.checkpointId),
            newArtifact: artifact,
        });
        await repository.commitCheckpointCatalog({
            ownerProjectId: ownerB,
            expectedCatalogRevision: null,
            nextState: nextState([branch('main', 'checkpoint-b')], 'main', 'checkpoint-b'),
            newArtifact: checkpoint('checkpoint-b', ownerB),
        });

        const database = await repository.openDatabase();
        if (!database) {
            throw new Error('Expected IndexedDB');
        }
        const artifactStore = database
            .transaction(repository.CHECKPOINT_ARTIFACT_STORE_NAME)
            .objectStore(repository.CHECKPOINT_ARTIFACT_STORE_NAME);
        const storePrototype = Object.getPrototypeOf(artifactStore) as IDBObjectStore;
        const indexPrototype = Object.getPrototypeOf(
            artifactStore.index(repository.CHECKPOINT_OWNER_PROJECT_INDEX_NAME)
        ) as IDBIndex;
        const valueReads: string[] = [];
        for (const method of ['get', 'getAll', 'openCursor'] as const) {
            const original = storePrototype[method];
            vi.spyOn(storePrototype, method).mockImplementation(function (this: IDBObjectStore, ...args: never[]) {
                if (this.name === repository.CHECKPOINT_ARTIFACT_STORE_NAME) {
                    valueReads.push(`store.${method}`);
                }
                return original.apply(this, args);
            } as never);
        }
        for (const method of ['get', 'getAll', 'openCursor'] as const) {
            const original = indexPrototype[method];
            vi.spyOn(indexPrototype, method).mockImplementation(function (this: IDBIndex, ...args: never[]) {
                if (this.objectStore.name === repository.CHECKPOINT_ARTIFACT_STORE_NAME) {
                    valueReads.push(`index.${method}`);
                }
                return original.apply(this, args);
            } as never);
        }

        await expect(repository.readCheckpointCatalog(ownerA)).resolves.toMatchObject({
            checkpoints: [{ checkpointId: 'checkpoint-a', ownerProjectId: ownerA }],
        });
        expect(valueReads).toEqual([]);
    });

    it('reads only the selected root and rejects owned incomplete or malformed selected data', async () => {
        const repository = await repositories();
        const first = checkpoint('first');
        const ownerCommit = await repository.commitCheckpointCatalog({
            ownerProjectId: ownerA,
            expectedCatalogRevision: null,
            nextState: nextState([branch('main', 'first')], 'main', 'first'),
            newArtifact: first,
        });
        if (ownerCommit.status !== 'committed') {
            throw new Error('Expected owner commit');
        }
        await repository.commitCheckpointCatalog({
            ownerProjectId: ownerB,
            expectedCatalogRevision: null,
            nextState: nextState([branch('main', 'other')], 'main', 'other'),
            newArtifact: checkpoint('other', ownerB),
        });
        const database = await repository.openDatabase();
        if (!database) {
            throw new Error('Expected IndexedDB');
        }
        const artifactStore = database
            .transaction(repository.CHECKPOINT_ARTIFACT_STORE_NAME)
            .objectStore(repository.CHECKPOINT_ARTIFACT_STORE_NAME);
        const prototype = Object.getPrototypeOf(artifactStore) as IDBObjectStore;
        const originalGet = artifactStore.get;
        const selectedReads: IDBValidKey[] = [];
        vi.spyOn(prototype, 'get').mockImplementation(function (
            this: IDBObjectStore,
            ...args: Parameters<IDBObjectStore['get']>
        ) {
            if (this.name === repository.CHECKPOINT_ARTIFACT_STORE_NAME) {
                selectedReads.push(args[0]);
            }
            return originalGet.apply(this, args);
        });

        await expect(repository.readCheckpointArtifact('first', ownerA)).resolves.toMatchObject({
            checkpointId: 'first',
            rootBytes: new Uint8Array([1, 2, 3]),
        });
        expect(selectedReads).toEqual(['first']);
        await expect(repository.readCheckpointArtifact('missing', ownerA)).resolves.toBeNull();
        await expect(repository.readCheckpointArtifact('other', ownerA)).resolves.toBeNull();
        await writeStoredValue(repository, repository.CHECKPOINT_ARTIFACT_STORE_NAME, 'other', {
            checkpointId: 'other',
            ownerProjectId: ownerB,
            rootBytes: new Uint8Array(),
        });
        await expect(repository.readCheckpointArtifact('other', ownerA)).resolves.toBeNull();

        await writeStoredValue(repository, repository.CHECKPOINT_OWNER_CATALOG_STORE_NAME, ownerA, {
            ownerProjectId: ownerA,
            catalogRevision: ownerCommit.catalogRevision,
            ...nextState([branch('main', 'first')], 'missing', 'first'),
        });
        await expect(repository.readCheckpointArtifact('first', ownerA)).rejects.toThrow(/currentBranchId/);
        await writeStoredValue(repository, repository.CHECKPOINT_OWNER_CATALOG_STORE_NAME, ownerA, {
            ownerProjectId: ownerA,
            catalogRevision: ownerCommit.catalogRevision,
            ...nextState([branch('main', 'first')], 'main', 'first'),
        });

        await writeStoredValue(repository, repository.CHECKPOINT_ARTIFACT_STORE_NAME, 'first', {
            checkpointId: 'first',
            ownerProjectId: ownerA,
            rootBytes: new Uint8Array(),
        });
        await expect(repository.readCheckpointArtifact('first', ownerA)).rejects.toThrow(/rootBytes/);
        await deleteStoredValue(repository, repository.CHECKPOINT_ARTIFACT_STORE_NAME, 'first');
        await expect(repository.readCheckpointArtifact('first', ownerA)).rejects.toThrow(/pair/);
    });

    it('rejects ownerless pairs and leaves absent-owner reads side-effect free', async () => {
        const repository = await repositories();
        const orphan = checkpoint('orphan');
        const { rootBytes, ...catalog } = orphan;
        await writeStoredValue(repository, repository.CHECKPOINT_ARTIFACT_STORE_NAME, orphan.checkpointId, {
            checkpointId: orphan.checkpointId,
            ownerProjectId: ownerA,
            rootBytes,
        });
        await writeStoredValue(repository, repository.CHECKPOINT_CATALOG_STORE_NAME, orphan.checkpointId, catalog);

        await expect(repository.readCheckpointCatalog(ownerA)).rejects.toThrow(/without owner catalog/);
        await expect(createOwner(repository, ownerA)).rejects.toThrow(/without owner catalog/);
        await expect(repository.readCheckpointCatalog('absent-owner')).resolves.toBeNull();
        expect(
            await readStoredValue(repository, repository.CHECKPOINT_OWNER_CATALOG_STORE_NAME, 'absent-owner')
        ).toBeUndefined();
    });
});
