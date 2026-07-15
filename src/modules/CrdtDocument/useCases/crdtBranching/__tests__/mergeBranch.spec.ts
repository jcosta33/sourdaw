import { describe, it, expect, vi, beforeEach } from 'vitest';

import { mergeBranch } from '../mergeBranch';

const SOURCE_DOC = { tag: 'source' };
const TARGET_DOC = { tag: 'target' };
const MERGED_DOC = { tag: 'merged' };

const docs: Record<string, unknown> = {};

const mocks = vi.hoisted(() => ({
    getDoc: vi.fn(),
    replaceDoc: vi.fn(),
    storeValue: {
        branches: [
            { branchId: 'main', rootDocId: 'root' },
            { branchId: 'feat', rootDocId: 'branch_feat' },
            { branchId: 'src', rootDocId: 'branch_src' },
        ],
        activeBranchId: 'feat',
    },
    compactProject: vi.fn(),
    projectCrdtToStores: vi.fn(),
    merge: vi.fn(() => MERGED_DOC),
    clone: vi.fn((d: unknown) => ({ tag: 'cloned', from: d })),
}));

vi.mock('@automerge/automerge', () => ({ merge: mocks.merge, clone: mocks.clone }));
vi.mock('../../../repositories/automergeRepository', () => ({
    automergeRepository: { getDoc: mocks.getDoc, replaceDoc: mocks.replaceDoc },
}));
vi.mock('../../../stores/branchStore', () => ({
    get branchStore() {
        return { value: mocks.storeValue };
    },
}));
vi.mock('../../compactProject', () => ({ compactProject: mocks.compactProject }));
vi.mock('../../projection/projectProjection', () => ({ projectCrdtToStores: mocks.projectCrdtToStores }));

describe('mergeBranch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        docs.root = TARGET_DOC;
        docs.branch_src = SOURCE_DOC;
        mocks.getDoc.mockImplementation((id: string) => docs[id]);
        mocks.merge.mockReturnValue(MERGED_DOC);
        mocks.storeValue.activeBranchId = 'feat';
        mocks.compactProject.mockResolvedValue(undefined);
    });

    it('merges the source into the active branch (root slot) and refreshes its snapshot', async () => {
        await mergeBranch('src');

        // Regression: merge resolves the active branch (feat) and merges source
        // into the root slot, then mirrors the result back to branch_feat so the
        // merge survives a later switch away.
        expect(mocks.merge).toHaveBeenCalledWith(TARGET_DOC, SOURCE_DOC);
        expect(mocks.replaceDoc).toHaveBeenCalledWith('root', MERGED_DOC);
        const snapshot = mocks.replaceDoc.mock.calls.find((c) => c[0] === 'branch_feat');
        expect(snapshot).toBeDefined();
        expect(mocks.compactProject).toHaveBeenCalledOnce();
    });

    it('propagates queued persistence errors before projecting merged state', async () => {
        const error = new Error('persist failed');
        mocks.compactProject.mockRejectedValueOnce(error);

        await expect(mergeBranch('src')).rejects.toBe(error);
        expect(mocks.projectCrdtToStores).not.toHaveBeenCalled();
    });

    it('rejects merging a branch into itself', async () => {
        mocks.storeValue.activeBranchId = 'src';
        await expect(mergeBranch('src')).rejects.toThrow(/into itself/);
        expect(mocks.merge).not.toHaveBeenCalled();
    });

    it('throws when the source branch is unknown', async () => {
        await expect(mergeBranch('ghost')).rejects.toThrow(/Source branch not found/);
    });

    it('throws when a document is missing', async () => {
        docs.branch_src = undefined;
        await expect(mergeBranch('src')).rejects.toThrow(/missing documents/);
    });
});
