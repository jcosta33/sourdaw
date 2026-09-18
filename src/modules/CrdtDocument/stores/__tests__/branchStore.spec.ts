import { stringify } from 'superjson';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_CRDT_ROOT_LINEAGE_LENGTH } from '../../models/CrdtRootLineage';
import {
    MAIN_BRANCH_DOC_ID,
    MAIN_BRANCH_ID,
    validateStoredBranchStoreState,
    type BranchRecord,
    type BranchStoreState,
} from '../branchStore';

const LEGACY_BRANCH_STORAGE_KEY = 'sourdaw-branches';
const BRANCH_STATE_STORAGE_KEY = 'sourdaw-branch-state';

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

/**
 * The sanitiser is called directly: nothing hydrates this store from storage
 * any more, so a stored value only reaches it as an argument — from the
 * authority's legacy seed, or from a collaboration peer's projection.
 */
function sanitizeStoredValue(storedValue: unknown): BranchStoreState {
    return validateStoredBranchStoreState(storedValue);
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
    afterEach(() => {
        window.localStorage.clear();
    });

    it('should use a stable id for the main branch', () => {
        expect(MAIN_BRANCH_ID).toBe('main');
    });

    it('is a memory projection: importing it neither reads nor writes durable branch state', async () => {
        const storedList = {
            branches: [validMainBranch, validFeatureBranch],
            activeBranchId: validFeatureBranch.branchId,
        } satisfies BranchStoreState;
        window.localStorage.setItem(LEGACY_BRANCH_STORAGE_KEY, stringify(storedList));
        window.localStorage.setItem(
            BRANCH_STATE_STORAGE_KEY,
            JSON.stringify({ version: 1, revision: 4, current: storedList, session: null })
        );
        vi.resetModules();

        const module = await import('../branchStore');

        // Hydration belongs to the branch-state authority: a store that read
        // storage on import would race the authority's boot recovery and could
        // resurrect a list a later instance already replaced.
        expectCanonicalSingleMainBranchState(module.branchStore.value);
        expect(window.localStorage.getItem(LEGACY_BRANCH_STORAGE_KEY)).toBe(stringify(storedList));
        expect(JSON.parse(window.localStorage.getItem(BRANCH_STATE_STORAGE_KEY) ?? 'null')).toEqual({
            version: 1,
            revision: 4,
            current: storedList,
            session: null,
        });
    });

    describe('stored value sanitisation', () => {
        it('should default corrupt stored state instead of hydrating raw invalid shape', async () => {
            const state = sanitizeStoredValue({
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

            expect(sanitizeStoredValue(validState)).toEqual(validState);
        });

        it('should preserve a main branch migrated to its independent backing document', async () => {
            const migratedState = {
                branches: [{ ...validMainBranch, rootDocId: MAIN_BRANCH_DOC_ID }, validFeatureBranch],
                activeBranchId: validFeatureBranch.branchId,
            } satisfies BranchStoreState;

            expect(sanitizeStoredValue(migratedState)).toEqual(migratedState);
        });

        it('should drop invalid branch records while preserving valid branch metadata', async () => {
            const state = sanitizeStoredValue({
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

            const state = sanitizeStoredValue({
                branches: [validMainBranch, validFeatureBranch, duplicateFeatureBranch],
                activeBranchId: validFeatureBranch.branchId,
            });

            expect(state).toEqual({
                branches: [validMainBranch, validFeatureBranch],
                activeBranchId: validFeatureBranch.branchId,
            });
        });

        it('should drop malformed and oversized branch lineage tokens', async () => {
            const invalidCharacters = {
                ...validFeatureBranch,
                branchId: 'feature/unsafe',
            };
            const oversized = {
                ...validFeatureBranch,
                branchId: 'x'.repeat(MAX_CRDT_ROOT_LINEAGE_LENGTH + 1),
            };
            const invalidSource = {
                ...validFeatureBranch,
                branchId: 'valid-feature',
                sourceBranchId: 'main/unsafe',
            };

            expect(
                sanitizeStoredValue({
                    branches: [validMainBranch, invalidCharacters, oversized, invalidSource, validFeatureBranch],
                    activeBranchId: validFeatureBranch.branchId,
                })
            ).toEqual({
                branches: [validMainBranch, validFeatureBranch],
                activeBranchId: validFeatureBranch.branchId,
            });
        });

        it('should reject a main branch record with an unknown backing document or source', async () => {
            const nonCanonicalMainBranch = {
                ...validMainBranch,
                rootDocId: validFeatureBranch.rootDocId,
                sourceBranchId: validFeatureBranch.branchId,
            } satisfies BranchRecord;

            const state = sanitizeStoredValue({
                branches: [nonCanonicalMainBranch, validFeatureBranch],
                activeBranchId: validFeatureBranch.branchId,
            });

            expectCanonicalSingleMainBranchState(state);
        });

        it('should fall back to canonical main state when no valid main branch remains', async () => {
            const state = sanitizeStoredValue({
                branches: [validFeatureBranch],
                activeBranchId: validFeatureBranch.branchId,
            });

            expectCanonicalSingleMainBranchState(state);
        });

        it('should fall back to main when active branch id is missing invalid or absent from branches', async () => {
            expect(
                sanitizeStoredValue({
                    branches: [validMainBranch, validFeatureBranch],
                    activeBranchId: 'missing',
                })
            ).toEqual({
                branches: [validMainBranch, validFeatureBranch],
                activeBranchId: MAIN_BRANCH_ID,
            });

            expect(
                sanitizeStoredValue({
                    branches: [validMainBranch, validFeatureBranch],
                    activeBranchId: 123,
                })
            ).toEqual({
                branches: [validMainBranch, validFeatureBranch],
                activeBranchId: MAIN_BRANCH_ID,
            });

            expect(
                sanitizeStoredValue({
                    branches: [validMainBranch, validFeatureBranch],
                })
            ).toEqual({
                branches: [validMainBranch, validFeatureBranch],
                activeBranchId: MAIN_BRANCH_ID,
            });
        });

        it('should default a stored value that is not a branch-state record', () => {
            expectCanonicalSingleMainBranchState(sanitizeStoredValue('{not-json'));
            expectCanonicalSingleMainBranchState(sanitizeStoredValue(null));
        });
    });
});
