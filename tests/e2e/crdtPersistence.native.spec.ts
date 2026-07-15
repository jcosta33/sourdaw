import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const CRDT_MODULE_DOCUMENT = '/src/modules/CrdtDocument/models/CrdtRootLineage.ts';
const CRDT_DATABASE_NAME = 'sourdaw-crdt-docs';
const TRANSACTION_GATE_KEY = '__sourdawCrdtTransactionGate';
const PENDING_COMPACTION_KEY = '__sourdawPendingCompaction';

async function openRealm(context: BrowserContext): Promise<Page> {
    const page = await context.newPage();
    await page.goto(CRDT_MODULE_DOCUMENT);
    return page;
}

async function clearCrdtDatabase(page: Page): Promise<void> {
    await page.evaluate(async (databaseName) => {
        localStorage.clear();
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(databaseName);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error ?? new Error('IndexedDB delete failed'));
            request.onblocked = () => reject(new Error('IndexedDB delete was blocked'));
        });
    }, CRDT_DATABASE_NAME);
}

async function resetAndCompact(page: Page, marker: string): Promise<void> {
    await page.evaluate(async (value) => {
        const [{ automergeRepository }, { compactProject }, { resetCrdtProjectAuthority }] = await Promise.all([
            import('/src/modules/CrdtDocument/repositories/automergeRepository.ts'),
            import('/src/modules/CrdtDocument/useCases/compactProject.ts'),
            import('/src/modules/CrdtDocument/useCases/resetCrdtProjectAuthority.ts'),
        ]);
        resetCrdtProjectAuthority('native IndexedDB test');
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.marker = value;
        });
        await compactProject();
    }, marker);
}

async function loadProject(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
        const { loadCrdtProject } = await import('/src/modules/CrdtDocument/useCases/loadCrdtProject.ts');
        return loadCrdtProject();
    });
}

async function mutateAndCompact(page: Page, key: string, value: unknown): Promise<void> {
    await page.evaluate(
        async ({ property, nextValue }) => {
            const [{ automergeRepository }, { compactProject }] = await Promise.all([
                import('/src/modules/CrdtDocument/repositories/automergeRepository.ts'),
                import('/src/modules/CrdtDocument/useCases/compactProject.ts'),
            ]);
            automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc[property] = nextValue;
            });
            await compactProject();
        },
        { property: key, nextValue: value }
    );
}

async function readRoot(page: Page): Promise<Record<string, unknown> | null> {
    return page.evaluate(async () => {
        const { automergeRepository } = await import('/src/modules/CrdtDocument/repositories/automergeRepository.ts');
        const root = automergeRepository.getDoc('root');
        return root ? (JSON.parse(JSON.stringify(root)) as Record<string, unknown>) : null;
    });
}

async function transitionLineage(page: Page, from: string, to: string, marker: string): Promise<void> {
    await page.evaluate(
        async ({ source, target, value }) => {
            const [{ automergeRepository }, { compactProject }, { runCrdtPersistenceOperation }] = await Promise.all([
                import('/src/modules/CrdtDocument/repositories/automergeRepository.ts'),
                import('/src/modules/CrdtDocument/useCases/compactProject.ts'),
                import('/src/modules/CrdtDocument/useCases/crdtPersistenceQueue.ts'),
            ]);
            await runCrdtPersistenceOperation({ type: 'root-lineage-transition', from: source, to: target });
            automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc.lineageMarker = value;
            });
            await compactProject();
        },
        { source: from, target: to, value: marker }
    );
}

async function compactOutcome(page: Page): Promise<{ name: string; message: string }> {
    return page.evaluate(async () => {
        const { compactProject } = await import('/src/modules/CrdtDocument/useCases/compactProject.ts');
        try {
            await compactProject();
            return { name: 'none', message: '' };
        } catch (error) {
            return {
                name: error instanceof Error ? error.name : typeof error,
                message: error instanceof Error ? error.message : String(error),
            };
        }
    });
}

async function installReadwriteTransactionGate(page: Page): Promise<void> {
    await page.evaluate(
        ({ gateKey }) => {
            const originalTransaction = IDBDatabase.prototype.transaction;
            const originalPut = IDBObjectStore.prototype.put;
            let targetTransaction: IDBTransaction | null = null;
            let keepAlive = true;
            let resolveWriteQueued!: () => void;
            const writeQueued = new Promise<void>((resolve) => {
                resolveWriteQueued = resolve;
            });

            function restore(): void {
                keepAlive = false;
                IDBDatabase.prototype.transaction = originalTransaction;
                IDBObjectStore.prototype.put = originalPut;
            }

            IDBDatabase.prototype.transaction = function transaction(storeNames, mode, options): IDBTransaction {
                const transaction = originalTransaction.call(this, storeNames, mode, options);
                if (targetTransaction || mode !== 'readwrite') {
                    return transaction;
                }

                targetTransaction = transaction;
                const store = transaction.objectStore('documents');
                const keepTransactionAlive = (): void => {
                    if (!keepAlive) {
                        return;
                    }
                    const request = store.get('__playwright_keepalive__');
                    request.onsuccess = keepTransactionAlive;
                    request.onerror = () => undefined;
                };
                keepTransactionAlive();
                transaction.addEventListener('abort', restore, { once: true });
                transaction.addEventListener('complete', restore, { once: true });
                return transaction;
            };

            IDBObjectStore.prototype.put = function put(value, key): IDBRequest<IDBValidKey> {
                const request = originalPut.call(this, value, key);
                if (targetTransaction && this.transaction === targetTransaction) {
                    resolveWriteQueued();
                }
                return request;
            };

            Reflect.set(globalThis, gateKey, { writeQueued, restore });
        },
        { gateKey: TRANSACTION_GATE_KEY }
    );
}

async function beginBlockedCompaction(page: Page): Promise<void> {
    await page.evaluate(
        async ({ gateKey, pendingKey }) => {
            const [{ automergeRepository }, { compactProject }] = await Promise.all([
                import('/src/modules/CrdtDocument/repositories/automergeRepository.ts'),
                import('/src/modules/CrdtDocument/useCases/compactProject.ts'),
            ]);
            const gate = Reflect.get(globalThis, gateKey) as { writeQueued: Promise<void> };
            automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc.abortedGeneration = true;
            });
            const pending = compactProject().then(
                () => ({ status: 'resolved' }),
                (error: unknown) => ({
                    status: 'rejected',
                    message: error instanceof Error ? error.message : String(error),
                })
            );
            Reflect.set(globalThis, pendingKey, pending);
            await gate.writeQueued;
        },
        { gateKey: TRANSACTION_GATE_KEY, pendingKey: PENDING_COMPACTION_KEY }
    );
}

async function abortGenerationAndCommitReplacement(page: Page): Promise<{ status: string; message?: string }> {
    return page.evaluate(async (pendingKey) => {
        const [{ automergeRepository }, { compactProject }, { resetCrdtProjectAuthority }] = await Promise.all([
            import('/src/modules/CrdtDocument/repositories/automergeRepository.ts'),
            import('/src/modules/CrdtDocument/useCases/compactProject.ts'),
            import('/src/modules/CrdtDocument/useCases/resetCrdtProjectAuthority.ts'),
        ]);
        resetCrdtProjectAuthority('replacement generation');
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.replacementGeneration = true;
        });
        await compactProject();
        const pending = Reflect.get(globalThis, pendingKey) as Promise<{ status: string; message?: string }>;
        return pending;
    }, PENDING_COMPACTION_KEY);
}

test.describe('CRDT persistence with native IndexedDB', () => {
    test('aborts an in-flight old generation transaction before replacement commit', async ({ context }) => {
        const realmA = await openRealm(context);
        const realmB = await openRealm(context);
        await clearCrdtDatabase(realmA);
        await resetAndCompact(realmA, 'baseline');
        await expect(loadProject(realmB)).resolves.toBe(true);

        await installReadwriteTransactionGate(realmA);
        await beginBlockedCompaction(realmA);
        await expect(abortGenerationAndCommitReplacement(realmA)).resolves.toEqual({ status: 'resolved' });

        await expect(loadProject(realmB)).resolves.toBe(true);
        const durableRoot = await readRoot(realmB);
        expect(durableRoot).toMatchObject({ replacementGeneration: true });
        expect(durableRoot).not.toHaveProperty('abortedGeneration');
    });

    test('merges same-lineage realms and rejects a stale different-lineage root', async ({ context }) => {
        const realmA = await openRealm(context);
        const realmB = await openRealm(context);
        await clearCrdtDatabase(realmA);
        await resetAndCompact(realmA, 'baseline');
        await expect(loadProject(realmB)).resolves.toBe(true);

        await mutateAndCompact(realmA, 'sameLineageA', true);
        await mutateAndCompact(realmB, 'sameLineageB', true);
        await expect(loadProject(realmA)).resolves.toBe(true);
        await expect(readRoot(realmA)).resolves.toMatchObject({ sameLineageA: true, sameLineageB: true });

        await transitionLineage(realmA, 'main', 'feature-native', 'feature');
        await expect(loadProject(realmB)).resolves.toBe(true);
        await transitionLineage(realmA, 'feature-native', 'main', 'main');

        await realmB.evaluate(async () => {
            const { automergeRepository } =
                await import('/src/modules/CrdtDocument/repositories/automergeRepository.ts');
            automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc.staleFeatureEdit = true;
            });
        });
        const firstRejection = await compactOutcome(realmB);
        const retryRejection = await compactOutcome(realmB);
        expect(firstRejection.message).toContain('Active root lineage changed in another realm');
        expect(retryRejection.message).toContain('Active root lineage changed in another realm');

        await expect(loadProject(realmB)).resolves.toBe(true);
        const durableMain = await readRoot(realmB);
        expect(durableMain).toMatchObject({ lineageMarker: 'main' });
        expect(durableMain).not.toHaveProperty('staleFeatureEdit');
    });
});
