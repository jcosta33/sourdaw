import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// This bounded fake proves IndexedDB request ordering and atomic transaction semantics.
// Browser reopen/recovery remains a separate integration obligation for the checkpoint feature.

type FakeRequest<Result> = {
    error: DOMException | null;
    onerror: (() => void) | null;
    onsuccess: (() => void) | null;
    result: Result;
};

type StoredValue = unknown;

const deletedValue = Symbol('deleted-value');

function copy<Value>(value: Value): Value {
    return value === undefined ? value : structuredClone(value);
}

class FakeTransaction {
    error: DOMException | null = null;
    onabort: (() => void) | null = null;
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;

    private aborted = false;
    private readonly operations: Array<() => void> = [];
    private readonly staged = new Map<string, Map<IDBValidKey, StoredValue>>();

    constructor(
        private readonly stores: Map<string, Map<IDBValidKey, StoredValue>>,
        private readonly scope: readonly string[],
        private readonly mode: IDBTransactionMode,
        private readonly shouldAbortAfterRequests: () => boolean,
        private readonly onRequestSuccess: () => void
    ) {
        for (const name of scope) {
            this.staged.set(name, new Map());
        }
        setTimeout(() => this.run(), 0);
    }

    abort(): void {
        this.aborted = true;
        this.error ??= new DOMException('Forced transaction abort', 'AbortError');
    }

    enqueue(operation: () => void): void {
        this.operations.push(operation);
    }

    objectStore(name: string): FakeObjectStore {
        if (!this.scope.includes(name)) {
            throw new DOMException(`Store ${name} is outside the transaction scope`, 'NotFoundError');
        }
        const committed = this.stores.get(name);
        const staged = this.staged.get(name);
        if (!committed || !staged) {
            throw new DOMException(`Store ${name} does not exist`, 'NotFoundError');
        }
        return new FakeObjectStore(this, committed, staged, this.mode, this.onRequestSuccess);
    }

    private run(): void {
        for (const operation of this.operations) {
            if (this.aborted) {
                break;
            }
            operation();
        }

        if (!this.aborted && this.mode === 'readwrite' && this.shouldAbortAfterRequests()) {
            this.abort();
        }
        if (this.aborted) {
            this.onabort?.();
            return;
        }

        for (const [storeName, stagedValues] of this.staged) {
            const committed = this.stores.get(storeName)!;
            for (const [key, value] of stagedValues) {
                if (value === deletedValue) {
                    committed.delete(key);
                } else {
                    committed.set(key, copy(value));
                }
            }
        }
        this.oncomplete?.();
    }

    fail(error: DOMException): void {
        this.error = error;
        this.aborted = true;
    }
}

class FakeObjectStore {
    constructor(
        private readonly transaction: FakeTransaction,
        private readonly committed: Map<IDBValidKey, StoredValue>,
        private readonly staged: Map<IDBValidKey, StoredValue>,
        private readonly mode: IDBTransactionMode,
        private readonly onRequestSuccess: () => void
    ) {}

    add(value: StoredValue, key: IDBValidKey): FakeRequest<IDBValidKey> {
        return this.request(() => {
            this.assertWritable();
            if (this.currentValue(key) !== undefined) {
                throw new DOMException('Key already exists', 'ConstraintError');
            }
            this.staged.set(key, copy(value));
            return key;
        });
    }

    clear(): FakeRequest<undefined> {
        return this.request(() => {
            this.assertWritable();
            for (const key of this.currentEntries().keys()) {
                this.staged.set(key, deletedValue);
            }
            return undefined;
        });
    }

    delete(key: IDBValidKey): FakeRequest<undefined> {
        return this.request(() => {
            this.assertWritable();
            this.staged.set(key, deletedValue);
            return undefined;
        });
    }

    get(key: IDBValidKey): FakeRequest<StoredValue> {
        return this.request(() => copy(this.currentValue(key)));
    }

    getAll(): FakeRequest<StoredValue[]> {
        return this.request(() => [...this.currentEntries().values()].map(copy));
    }

    getAllKeys(): FakeRequest<IDBValidKey[]> {
        return this.request(() => [...this.currentEntries().keys()]);
    }

    put(value: StoredValue, key: IDBValidKey): FakeRequest<IDBValidKey> {
        return this.request(() => {
            this.assertWritable();
            this.staged.set(key, copy(value));
            return key;
        });
    }

    private assertWritable(): void {
        if (this.mode !== 'readwrite') {
            throw new DOMException('Transaction is readonly', 'ReadOnlyError');
        }
    }

    private currentEntries(): Map<IDBValidKey, StoredValue> {
        const entries = new Map(this.committed);
        for (const [key, value] of this.staged) {
            if (value === deletedValue) {
                entries.delete(key);
            } else {
                entries.set(key, value);
            }
        }
        return entries;
    }

    private currentValue(key: IDBValidKey): StoredValue {
        if (!this.staged.has(key)) {
            return this.committed.get(key);
        }
        const value = this.staged.get(key);
        return value === deletedValue ? undefined : value;
    }

    private request<Result>(operation: () => Result): FakeRequest<Result> {
        const request: FakeRequest<Result> = {
            error: null,
            onerror: null,
            onsuccess: null,
            result: undefined as Result,
        };
        this.transaction.enqueue(() => {
            try {
                request.result = operation();
                this.onRequestSuccess();
                request.onsuccess?.();
            } catch (error) {
                request.error =
                    error instanceof DOMException
                        ? error
                        : new DOMException(error instanceof Error ? error.message : String(error), 'UnknownError');
                request.onerror?.();
                this.transaction.fail(request.error);
            }
        });
        return request;
    }
}

type FakeIndexedDbControl = {
    abortNextWriteAfterRequests: () => void;
    inspect: (storeName: string, key: IDBValidKey) => StoredValue;
    requestSuccessCount: () => number;
    seed: (storeName: string, key: IDBValidKey, value: StoredValue) => void;
};

function installCheckpointIndexedDb(): FakeIndexedDbControl {
    const stores = new Map<string, Map<IDBValidKey, StoredValue>>();
    let databaseVersion = 0;
    let abortNextWrite = false;
    let successfulRequests = 0;

    vi.stubGlobal('indexedDB', {
        open: (_name: string, version = 1) => {
            const connection = {
                close: (): void => undefined,
                createObjectStore: (name: string): undefined => {
                    if (stores.has(name)) {
                        throw new DOMException(`Store ${name} already exists`, 'ConstraintError');
                    }
                    stores.set(name, new Map());
                    return undefined;
                },
                objectStoreNames: { contains: (name: string): boolean => stores.has(name) },
                onversionchange: null as (() => void) | null,
                transaction: (names: string | string[], mode: IDBTransactionMode = 'readonly') => {
                    const scope = typeof names === 'string' ? [names] : [...names];
                    return new FakeTransaction(
                        stores,
                        scope,
                        mode,
                        () => {
                            if (!abortNextWrite) {
                                return false;
                            }
                            abortNextWrite = false;
                            return true;
                        },
                        () => successfulRequests++
                    );
                },
            };
            const request = {
                error: null as DOMException | null,
                onblocked: null as (() => void) | null,
                onerror: null as (() => void) | null,
                onsuccess: null as (() => void) | null,
                onupgradeneeded: null as (() => void) | null,
                result: connection,
            };
            setTimeout(() => {
                if (version < databaseVersion) {
                    request.error = new DOMException('Requested version is too old', 'VersionError');
                    request.onerror?.();
                    return;
                }
                if (version > databaseVersion) {
                    request.onupgradeneeded?.();
                    databaseVersion = version;
                }
                request.onsuccess?.();
            }, 0);
            return request;
        },
    });

    return {
        abortNextWriteAfterRequests: () => {
            abortNextWrite = true;
        },
        inspect: (storeName, key) => copy(stores.get(storeName)?.get(key)),
        requestSuccessCount: () => successfulRequests,
        seed: (storeName, key, value) => {
            const store = stores.get(storeName);
            if (!store) {
                throw new Error(`Store ${storeName} has not been created`);
            }
            store.set(key, copy(value));
        },
    };
}

const ownerA = 'project-a';
const ownerB = 'project-b';

function checkpoint(
    checkpointId: string,
    overrides: Partial<{
        audioBufferIds: string[];
        createdAt: string;
        description: string;
        label: string;
        ownerProjectId: string;
        ownershipToken: string;
        parentId: string | null;
        rootBytes: Uint8Array;
        tags: string[];
    }> = {}
) {
    return {
        checkpointId,
        ownerProjectId: ownerA,
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

async function repositories() {
    const [commitModule, deleteModule, listModule, readModule, helpers] = await Promise.all([
        import('../commitCheckpointArtifact'),
        import('../deleteCheckpointArtifact'),
        import('../listCheckpointCatalog'),
        import('../readCheckpointArtifact'),
        import('../helpers'),
    ]);
    return {
        commitCheckpointArtifact: commitModule.commitCheckpointArtifact,
        deleteCheckpointArtifact: deleteModule.deleteCheckpointArtifact,
        listCheckpointCatalog: listModule.listCheckpointCatalog,
        readCheckpointArtifact: readModule.readCheckpointArtifact,
        ...helpers,
    };
}

describe('checkpoint artifact persistence (simulated IndexedDB contract)', () => {
    let database: FakeIndexedDbControl;

    beforeEach(() => {
        vi.resetModules();
        database = installCheckpointIndexedDb();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('commits and reads independent bytes and normalized metadata', async () => {
        const { commitCheckpointArtifact, readCheckpointArtifact } = await repositories();
        const input = checkpoint('checkpoint-a');
        const expected = {
            ...input,
            tags: ['manual'],
            audioBufferIds: ['buffer-a', 'buffer-b'],
            rootBytes: new Uint8Array([1, 2, 3]),
        };

        const committing = commitCheckpointArtifact(input);
        input.rootBytes[0] = 99;
        input.tags.push('mutated');
        input.audioBufferIds[0] = 'mutated-buffer';
        await committing;

        const firstRead = await readCheckpointArtifact('checkpoint-a', ownerA);
        expect(firstRead).toEqual(expected);
        firstRead!.rootBytes[0] = 77;
        firstRead!.tags.push('output-mutation');
        firstRead!.audioBufferIds[0] = 'output-mutation';

        await expect(readCheckpointArtifact('checkpoint-a', ownerA)).resolves.toEqual(expected);
    });

    it('rejects duplicate checkpoint ids atomically and preserves the first pair', async () => {
        const { commitCheckpointArtifact, readCheckpointArtifact } = await repositories();
        const first = checkpoint('duplicate', { rootBytes: new Uint8Array([1]) });
        await commitCheckpointArtifact(first);

        await expect(
            commitCheckpointArtifact(
                checkpoint('duplicate', {
                    ownerProjectId: ownerB,
                    ownershipToken: 'other-token',
                    rootBytes: new Uint8Array([9]),
                })
            )
        ).rejects.toMatchObject({ name: 'ConstraintError' });

        await expect(readCheckpointArtifact('duplicate', ownerA)).resolves.toEqual({
            ...first,
            audioBufferIds: ['buffer-a', 'buffer-b'],
        });
        await expect(readCheckpointArtifact('duplicate', ownerB)).resolves.toBeNull();
    });

    it('isolates owners and lists matching catalog rows in created-at then id order', async () => {
        const { commitCheckpointArtifact, deleteCheckpointArtifact, listCheckpointCatalog, readCheckpointArtifact } =
            await repositories();
        await commitCheckpointArtifact(checkpoint('z-last', { createdAt: '2026-09-05T12:00:00.000Z' }));
        await commitCheckpointArtifact(checkpoint('b-same-time'));
        await commitCheckpointArtifact(checkpoint('a-same-time'));
        await commitCheckpointArtifact(checkpoint('owner-b', { ownerProjectId: ownerB }));

        await expect(readCheckpointArtifact('a-same-time', ownerB)).resolves.toBeNull();
        await expect(deleteCheckpointArtifact('a-same-time', ownerB)).resolves.toBeNull();
        await expect(listCheckpointCatalog(ownerB)).resolves.toEqual([
            expect.objectContaining({ checkpointId: 'owner-b', ownerProjectId: ownerB }),
        ]);

        const ownerACatalog = await listCheckpointCatalog(ownerA);
        expect(ownerACatalog.map(({ checkpointId }) => checkpointId)).toEqual(['a-same-time', 'b-same-time', 'z-last']);
        expect(ownerACatalog[0]).not.toHaveProperty('rootBytes');
        await expect(readCheckpointArtifact('a-same-time', ownerA)).resolves.not.toBeNull();
    });

    it('rejects when the transaction aborts after both add requests succeed and publishes neither row', async () => {
        const {
            CHECKPOINT_ARTIFACT_STORE_NAME,
            CHECKPOINT_CATALOG_STORE_NAME,
            commitCheckpointArtifact,
            readCheckpointArtifact,
        } = await repositories();
        database.abortNextWriteAfterRequests();

        await expect(commitCheckpointArtifact(checkpoint('aborted'))).rejects.toMatchObject({ name: 'AbortError' });

        expect(database.requestSuccessCount()).toBeGreaterThanOrEqual(2);
        expect(database.inspect(CHECKPOINT_ARTIFACT_STORE_NAME, 'aborted')).toBeUndefined();
        expect(database.inspect(CHECKPOINT_CATALOG_STORE_NAME, 'aborted')).toBeUndefined();
        await expect(readCheckpointArtifact('aborted', ownerA)).resolves.toBeNull();
    });

    it('keeps checkpoints across document replacement and a module reset/reopen', async () => {
        const firstModules = await repositories();
        const { replaceAllInIdb } = await import('../replaceAllInIdb');
        await replaceAllInIdb(new Map([['root-a', new Uint8Array([1])]]));
        await firstModules.commitCheckpointArtifact(checkpoint('persistent'));
        await replaceAllInIdb(new Map([['root-b', new Uint8Array([2])]]));

        vi.resetModules();
        const reopenedModules = await repositories();

        await expect(reopenedModules.readCheckpointArtifact('persistent', ownerA)).resolves.toEqual({
            ...checkpoint('persistent'),
            audioBufferIds: ['buffer-a', 'buffer-b'],
        });
        await expect(reopenedModules.listCheckpointCatalog(ownerA)).resolves.toEqual([
            expect.objectContaining({ checkpointId: 'persistent' }),
        ]);
    });

    it('deletes both rows atomically and returns the exact retained-media ownership token', async () => {
        const {
            CHECKPOINT_ARTIFACT_STORE_NAME,
            CHECKPOINT_CATALOG_STORE_NAME,
            commitCheckpointArtifact,
            deleteCheckpointArtifact,
            readCheckpointArtifact,
        } = await repositories();
        await commitCheckpointArtifact(checkpoint('delete-me', { ownershipToken: 'retention-token-42' }));

        database.abortNextWriteAfterRequests();
        await expect(deleteCheckpointArtifact('delete-me', ownerA)).rejects.toMatchObject({ name: 'AbortError' });
        await expect(readCheckpointArtifact('delete-me', ownerA)).resolves.not.toBeNull();

        await expect(deleteCheckpointArtifact('delete-me', ownerA)).resolves.toEqual({
            checkpointId: 'delete-me',
            projectOwnerId: ownerA,
            ownershipToken: 'retention-token-42',
        });
        await expect(readCheckpointArtifact('delete-me', ownerA)).resolves.toBeNull();
        expect(database.inspect(CHECKPOINT_ARTIFACT_STORE_NAME, 'delete-me')).toBeUndefined();
        expect(database.inspect(CHECKPOINT_CATALOG_STORE_NAME, 'delete-me')).toBeUndefined();
    });

    it('rejects unsupported or corrupt input before publishing any row', async () => {
        const { CHECKPOINT_ARTIFACT_STORE_NAME, CHECKPOINT_CATALOG_STORE_NAME, commitCheckpointArtifact } =
            await repositories();
        const sparseAudioBufferIds: string[] = [];
        sparseAudioBufferIds.length = 2;
        sparseAudioBufferIds[1] = 'buffer-a';
        const sparseTags: string[] = [];
        sparseTags.length = 2;
        sparseTags[1] = 'manual';

        await expect(
            commitCheckpointArtifact(checkpoint('empty-root', { rootBytes: new Uint8Array() }))
        ).rejects.toThrow(/rootBytes/);
        await expect(
            commitCheckpointArtifact(checkpoint('sparse-audio', { audioBufferIds: sparseAudioBufferIds }))
        ).rejects.toThrow(/audioBufferIds/);
        await expect(commitCheckpointArtifact(checkpoint('sparse-tags', { tags: sparseTags }))).rejects.toThrow(/tags/);
        await expect(commitCheckpointArtifact(checkpoint('empty-audio-id', { audioBufferIds: [''] }))).rejects.toThrow(
            /audioBufferIds/
        );
        await expect(commitCheckpointArtifact(checkpoint('bad-date', { createdAt: 'yesterday' }))).rejects.toThrow(
            /createdAt/
        );

        for (const checkpointId of ['empty-root', 'sparse-audio', 'sparse-tags', 'empty-audio-id', 'bad-date']) {
            expect(database.inspect(CHECKPOINT_ARTIFACT_STORE_NAME, checkpointId)).toBeUndefined();
            expect(database.inspect(CHECKPOINT_CATALOG_STORE_NAME, checkpointId)).toBeUndefined();
        }
    });

    it('fails explicitly on a one-sided or mismatched stored pair without destructive cleanup', async () => {
        const {
            CHECKPOINT_ARTIFACT_STORE_NAME,
            CHECKPOINT_CATALOG_STORE_NAME,
            commitCheckpointArtifact,
            deleteCheckpointArtifact,
            listCheckpointCatalog,
            readCheckpointArtifact,
        } = await repositories();
        await commitCheckpointArtifact(checkpoint('seed-schema'));
        database.seed(CHECKPOINT_CATALOG_STORE_NAME, 'catalog-only', {
            ...checkpoint('catalog-only'),
            rootBytes: undefined,
            audioBufferIds: ['buffer-a'],
        });
        database.seed(CHECKPOINT_ARTIFACT_STORE_NAME, 'mismatched', {
            checkpointId: 'mismatched',
            ownerProjectId: ownerB,
            rootBytes: new Uint8Array([4]),
        });
        database.seed(CHECKPOINT_CATALOG_STORE_NAME, 'mismatched', {
            ...checkpoint('mismatched'),
            rootBytes: undefined,
            audioBufferIds: ['buffer-a'],
        });

        await expect(readCheckpointArtifact('catalog-only', ownerA)).rejects.toThrow(/pair/);
        await expect(readCheckpointArtifact('mismatched', ownerA)).rejects.toThrow(/mismatch/);
        await expect(listCheckpointCatalog(ownerA)).rejects.toThrow(/pair|mismatch/);
        await expect(deleteCheckpointArtifact('mismatched', ownerA)).rejects.toThrow(/mismatch/);
        expect(database.inspect(CHECKPOINT_CATALOG_STORE_NAME, 'catalog-only')).toBeDefined();
        expect(database.inspect(CHECKPOINT_ARTIFACT_STORE_NAME, 'mismatched')).toBeDefined();
        expect(database.inspect(CHECKPOINT_CATALOG_STORE_NAME, 'mismatched')).toBeDefined();
    });

    it('rejects lookup-key mismatch for read and delete while preserving both rows', async () => {
        const {
            CHECKPOINT_ARTIFACT_STORE_NAME,
            CHECKPOINT_CATALOG_STORE_NAME,
            commitCheckpointArtifact,
            deleteCheckpointArtifact,
            readCheckpointArtifact,
        } = await repositories();
        await commitCheckpointArtifact(checkpoint('seed-schema'));
        const artifact = {
            checkpointId: 'different',
            ownerProjectId: ownerA,
            rootBytes: new Uint8Array([8]),
        };
        const catalog = {
            ...checkpoint('different', { ownershipToken: 'known-retention-token' }),
            rootBytes: undefined,
            audioBufferIds: ['buffer-a'],
        };
        database.seed(CHECKPOINT_ARTIFACT_STORE_NAME, 'requested', artifact);
        database.seed(CHECKPOINT_CATALOG_STORE_NAME, 'requested', catalog);

        await expect(readCheckpointArtifact('requested', ownerA)).rejects.toThrow(/identity mismatch/);
        await expect(deleteCheckpointArtifact('requested', ownerA)).rejects.toThrow(/identity mismatch/);
        const storedArtifact = database.inspect(CHECKPOINT_ARTIFACT_STORE_NAME, 'requested') as typeof artifact;
        expect(storedArtifact).toMatchObject({ checkpointId: 'different', ownerProjectId: ownerA });
        expect(Array.from(storedArtifact.rootBytes)).toEqual([8]);
        expect(database.inspect(CHECKPOINT_CATALOG_STORE_NAME, 'requested')).toEqual(catalog);
    });

    it('rejects writes when IndexedDB is unavailable', async () => {
        vi.stubGlobal('indexedDB', undefined);
        vi.resetModules();
        const { commitCheckpointArtifact } = await repositories();

        await expect(commitCheckpointArtifact(checkpoint('unsupported'))).rejects.toThrow(/unavailable/);
    });
});
