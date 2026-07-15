import { clone as cloneDoc } from '@automerge/automerge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../../../repositories/automergeRepository';
import { loadAllFromIdb } from '../../../repositories/crdtPersistence/loadAllFromIdb';
import {
    TransactionalPersistence,
    type TransactionalPersistenceTransaction,
} from '../../__tests__/helpers/transactionalPersistence';
import { compactProject } from '../../compactProject';
import { runCrdtPersistenceOperation } from '../../crdtPersistenceQueue';
import { crdtProjectCompactionState } from '../../crdtProjectCompactionState';
import { persistCrdtProject } from '../../persistCrdtProject';
import { mergeBranch } from '../mergeBranch';

const mocks = vi.hoisted(() => ({
    openDatabase: vi.fn(),
    branchState: {
        branches: [] as Array<{ branchId: string; rootDocId: string }>,
        activeBranchId: 'feat',
    },
    projectCrdtToStores: vi.fn(),
}));

vi.mock('../../../repositories/crdtPersistence/helpers', () => ({
    STORE_NAME: 'documents',
    openDatabase: mocks.openDatabase,
}));
vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({
    flushAutomergeStorageWrites: vi.fn(),
}));
vi.mock('../../../stores/branchStore', () => ({
    get branchStore() {
        return { value: mocks.branchState };
    },
}));
vi.mock('../../projection/projectProjection', () => ({ projectCrdtToStores: mocks.projectCrdtToStores }));

vi.stubGlobal(
    'Worker',
    class UnavailableWorker {
        constructor() {
            throw new Error('worker unavailable in persistence test');
        }
    }
);

async function readBundle(
    persistence: TransactionalPersistence,
    occurrence: number
): Promise<Awaited<ReturnType<typeof loadAllFromIdb>>> {
    const load = loadAllFromIdb();
    const transaction = await persistence.waitForTransaction('readonly', occurrence);
    transaction.complete();
    return load;
}

function bundleFromTransaction(transaction: TransactionalPersistenceTransaction): Map<string, Uint8Array> {
    return new Map(
        transaction.writes
            .filter((write) => write.kind === 'put')
            .map((write) => [write.key, new Uint8Array(write.value)] as const)
    );
}

describe('mergeBranch persistence', () => {
    let persistence: TransactionalPersistence;

    beforeEach(() => {
        vi.clearAllMocks();
        persistence = new TransactionalPersistence();
        mocks.openDatabase.mockResolvedValue(persistence.database);
        mocks.branchState.branches = [
            { branchId: 'main', rootDocId: 'root' },
            { branchId: 'feat', rootDocId: 'branch_feat' },
            { branchId: 'src', rootDocId: 'branch_src' },
        ];
        mocks.branchState.activeBranchId = 'feat';
        automergeRepository.reset();
        void runCrdtPersistenceOperation('reset');
        crdtProjectCompactionState.incrementalSaveCount = 0;
    });

    it('keeps a merged non-main branch ahead of a retained full snapshot during autosave', async () => {
        automergeRepository.createProject('project');
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.base = true;
        });

        const rootDoc = automergeRepository.getDoc('root');
        if (!rootDoc) {
            throw new Error('Expected the root document');
        }
        automergeRepository.insertDoc('branch_feat', cloneDoc(rootDoc));
        automergeRepository.createChildDoc('branch_src');
        automergeRepository.changeDoc('branch_src', (doc: Record<string, unknown>) => {
            doc.sourceOnly = 'merged';
        });
        const branchDoc = automergeRepository.getDoc('branch_feat');
        if (!branchDoc) {
            throw new Error('Expected the active branch document');
        }
        automergeRepository.replaceDoc('root', cloneDoc(branchDoc));

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        const failedCompaction = compactProject();
        const failedFullSave = await persistence.waitForTransaction('readwrite', 2);
        const retainedBundle = bundleFromTransaction(failedFullSave);
        expect(retainedBundle.get('root')).toBeDefined();
        failedFullSave.abort();
        await expect(failedCompaction).rejects.toThrow('IDB transaction aborted');

        const merge = mergeBranch('src');
        const firstMergeTransaction = await persistence.waitForTransaction('readwrite', 3);
        expect(bundleFromTransaction(firstMergeTransaction)).toEqual(retainedBundle);
        firstMergeTransaction.complete();

        const autosave = persistCrdtProject();
        const secondMergeTransaction = await persistence.waitForTransaction('readwrite', 4);
        secondMergeTransaction.complete();
        await merge;
        await autosave;

        const bundle = await readBundle(persistence, 1);
        if (!bundle) {
            throw new Error('Expected the merged project bundle');
        }
        expect(bundle).not.toEqual(retainedBundle);
        expect(bundle.get('root')).not.toEqual(retainedBundle.get('root'));

        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => true })).resolves.toBe(true);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            base: true,
            sourceOnly: 'merged',
        });
        expect(automergeRepository.getDoc<Record<string, unknown>>('branch_feat')).toMatchObject({
            base: true,
            sourceOnly: 'merged',
        });
    });
});
