import { stringify } from 'superjson';
import { describe, expect, it, vi } from 'vitest';

import { MAIN_BRANCH_ID, type BranchRecord, type BranchStoreState } from '../branchStore';

const BRANCH_STORAGE_KEY = 'sourdaw-branches';

const validMainBranch = {
    branchId: MAIN_BRANCH_ID,
    name: 'Main',
    rootDocId: 'root',
    sourceBranchId: null,
    createdAt: 100,
    createdFromHeads: [],
    note: '',
} satisfies BranchRecord;

const validFeatureBranch = {
    branchId: 'feature',
    name: 'Feature',
    rootDocId: 'branch_feature',
    sourceBranchId: MAIN_BRANCH_ID,
    createdAt: 200,
    createdFromHeads: ['head-1', 'head-2'],
    note: 'Useful branch',
} satisfies BranchRecord;

async function loadBranchStateFromStoredValue(storedValue: unknown): Promise<BranchStoreState | null> {
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem(BRANCH_STORAGE_KEY, stringify(storedValue));

    const module = await import('../branchStore');
    return module.branchStore.value;
}

async function loadBranchStateFromRawStoredValue(storedValue: string): Promise<BranchStoreState | null> {
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem(BRANCH_STORAGE_KEY, storedValue);

    const module = await import('../branchStore');
    return module.branchStore.value;
}

function expectCanonicalSingleMainBranchState(state: BranchStoreState | null): void {
    expect(state).not.toBeNull();
    if (state === null) {
        return;
    }

    expect(state.activeBranchId).toBe(MAIN_BRANCH_ID);
    expect(state.branches).toHaveLength(1);
    expect(state.branches[0]).toEqual({
        branchId: MAIN_BRANCH_ID,
        name: 'Main',
        rootDocId: 'root',
        sourceBranchId: null,
        createdAt: state.branches[0]?.createdAt,
        createdFromHeads: [],
        note: '',
    });
    expect(typeof state.branches[0]?.createdAt).toBe('number');
    expect(Number.isFinite(state.branches[0]?.createdAt)).toBe(true);
}

describe('branchStore', () => {
    it('should use a stable id for the main branch', () => {
        expect(MAIN_BRANCH_ID).toBe('main');
    });

    describe('persisted hydration', () => {
        it('should default corrupt stored state instead of hydrating raw invalid shape', async () => {
            const state = await loadBranchStateFromStoredValue({
                branches: 'not-branches',
                activeBranchId: {},
            });

            expectCanonicalSingleMainBranchState(state);
        });

        it('should preserve valid stored branches and active branch id', async () => {
            const validState = {
                branches: [validMainBranch, validFeatureBranch],
                activeBranchId: validFeatureBranch.branchId,
            } satisfies BranchStoreState;

            await expect(loadBranchStateFromStoredValue(validState)).resolves.toEqual(validState);
        });

        it('should drop invalid branch records while preserving valid branch metadata', async () => {
            const state = await loadBranchStateFromStoredValue({
                branches: [
                    validMainBranch,
                    {
                        branchId: 'missing-note',
                        name: 'Missing note',
                        rootDocId: 'branch_missing_note',
                        sourceBranchId: MAIN_BRANCH_ID,
                        createdAt: 300,
                        createdFromHeads: [],
                    },
                    {
                        branchId: 'bad-heads',
                        name: 'Bad heads',
                        rootDocId: 'branch_bad_heads',
                        sourceBranchId: MAIN_BRANCH_ID,
                        createdAt: 400,
                        createdFromHeads: ['head-1', 2],
                        note: '',
                    },
                    validFeatureBranch,
                ],
                activeBranchId: validFeatureBranch.branchId,
            });

            expect(state).toEqual({
                branches: [validMainBranch, validFeatureBranch],
                activeBranchId: validFeatureBranch.branchId,
            });
        });

        it('should drop duplicate branch ids while preserving the first valid record', async () => {
            const duplicateFeatureBranch = {
                ...validFeatureBranch,
                name: 'Duplicate feature',
                rootDocId: 'branch_duplicate_feature',
            } satisfies BranchRecord;

            const state = await loadBranchStateFromStoredValue({
                branches: [validMainBranch, validFeatureBranch, duplicateFeatureBranch],
                activeBranchId: validFeatureBranch.branchId,
            });

            expect(state).toEqual({
                branches: [validMainBranch, validFeatureBranch],
                activeBranchId: validFeatureBranch.branchId,
            });
        });

        it('should reject a main branch record that is not backed by the root slot', async () => {
            const nonCanonicalMainBranch = {
                ...validMainBranch,
                rootDocId: validFeatureBranch.rootDocId,
                sourceBranchId: validFeatureBranch.branchId,
            } satisfies BranchRecord;

            const state = await loadBranchStateFromStoredValue({
                branches: [nonCanonicalMainBranch, validFeatureBranch],
                activeBranchId: validFeatureBranch.branchId,
            });

            expectCanonicalSingleMainBranchState(state);
        });

        it('should fall back to canonical main state when no valid main branch remains', async () => {
            const state = await loadBranchStateFromStoredValue({
                branches: [validFeatureBranch],
                activeBranchId: validFeatureBranch.branchId,
            });

            expectCanonicalSingleMainBranchState(state);
        });

        it('should fall back to main when active branch id is missing invalid or absent from branches', async () => {
            await expect(
                loadBranchStateFromStoredValue({
                    branches: [validMainBranch, validFeatureBranch],
                    activeBranchId: 'missing',
                })
            ).resolves.toEqual({
                branches: [validMainBranch, validFeatureBranch],
                activeBranchId: MAIN_BRANCH_ID,
            });

            await expect(
                loadBranchStateFromStoredValue({
                    branches: [validMainBranch, validFeatureBranch],
                    activeBranchId: 123,
                })
            ).resolves.toEqual({
                branches: [validMainBranch, validFeatureBranch],
                activeBranchId: MAIN_BRANCH_ID,
            });

            await expect(
                loadBranchStateFromStoredValue({
                    branches: [validMainBranch, validFeatureBranch],
                })
            ).resolves.toEqual({
                branches: [validMainBranch, validFeatureBranch],
                activeBranchId: MAIN_BRANCH_ID,
            });
        });

        it('should default malformed raw local storage text', async () => {
            const state = await loadBranchStateFromRawStoredValue('{not-json');

            expectCanonicalSingleMainBranchState(state);
        });
    });
});
