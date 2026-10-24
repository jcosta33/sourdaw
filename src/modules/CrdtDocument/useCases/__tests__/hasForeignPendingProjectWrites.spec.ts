import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';

import { hasForeignPendingProjectWrites } from '../hasForeignPendingProjectWrites';

describe('hasForeignPendingProjectWrites', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 1)
        );
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        const docs: Record<string, Record<string, unknown>> = { root: {}, other: {} };
        configureAutomergeStoragePort({
            getDoc: (docId) => docs[docId],
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => Object.hasOwn(docs, docId),
            mutateDoc: ({ docId, changeFn }) => changeFn(docs[docId]!),
        });
    });

    afterEach(() => {
        resetAutomergeStorageProjections('root');
        resetAutomergeStorageProjections('other');
        configureAutomergeStoragePort(null);
        flushAutomergeStorageWrites();
        vi.unstubAllGlobals();
    });

    it('ignores its own queued root write but sees another owner after that owner returns', () => {
        const storage = createAutomergeStorage<{ count: number }>('root', 'slot');
        let ownPending = true;
        const foreign = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 1 });
            ownPending = hasForeignPendingProjectWrites();
        });
        expect(ownPending).toBe(false);
        expect(hasForeignPendingProjectWrites()).toBe(true);
        let seesForeign = false;
        const current = runWithAutomergeStorageTransaction(undefined, () => {
            seesForeign = hasForeignPendingProjectWrites();
        });
        expect(seesForeign).toBe(true);
        current.abort();
        foreign.abort();
        expect(hasForeignPendingProjectWrites()).toBe(false);
    });

    it('ignores a pending write to another document', () => {
        const storage = createAutomergeStorage<{ count: number }>('other', 'slot');
        const foreign = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 1 }));
        expect(hasForeignPendingProjectWrites()).toBe(false);
        foreign.abort();
    });
});
