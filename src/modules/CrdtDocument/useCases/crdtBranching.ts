import * as Automerge from '@automerge/automerge';

import { DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';
import { type BranchRecord, MAIN_BRANCH_ID } from '../models/BranchTypes';
import { automergeRepository } from '../repositories/automergeRepository';
import { saveAllToIdb } from '../repositories/crdtPersistence';
import { branchStore } from '../stores/branchStore';
import { projectCrdtToStores } from './projection/projectProjection';

/**
 * Fork the current project into a new branch.
 * Uses Automerge.clone() for a fast copy that shares history with the source.
 */
export const forkProjectBranch = async (name: string, note = ''): Promise<string> => {
    const state = branchStore.value;
    if (!state) {
        throw new Error('Branch store not initialized');
    }

    const sourceDoc = automergeRepository.getDoc(DOC_PREFIX_ROOT);
    if (!sourceDoc) {
        throw new Error('No root document to fork');
    }

    const branchId = crypto.randomUUID();
    const branchDocId = `branch_${branchId}`;
    const heads = Automerge.getHeads(sourceDoc).map(String);

    // Clone the document — shares full history with source
    const forkedDoc = Automerge.clone(sourceDoc);
    automergeRepository.insertDoc(branchDocId, forkedDoc);

    const record: BranchRecord = {
        branchId,
        name,
        rootDocId: branchDocId,
        sourceBranchId: state.activeBranchId,
        createdAt: Date.now(),
        createdFromHeads: heads,
        note,
    };

    branchStore.set({
        branches: [...state.branches, record],
        activeBranchId: branchId,
    });

    // Persist the new branch document
    const bundle = automergeRepository.saveAll();
    await saveAllToIdb(bundle);

    // Hydrate stores from the forked branch
    projectCrdtToStores();

    return branchId;
};

/**
 * Switch to a different branch.
 */
export const switchBranch = (branchId: string): void => {
    const state = branchStore.value;
    if (!state) {
        return;
    }

    const branch = state.branches.find((b) => b.branchId === branchId);
    if (!branch) {
        throw new Error(`Branch not found: ${branchId}`);
    }

    // The branch's doc is already in the repository (loaded at startup or fork time).
    // We just need to tell AutomergeStorage which doc ID to use.
    // For now, we swap the root doc reference.
    const branchDoc = automergeRepository.getDoc(branch.rootDocId);
    if (!branchDoc) {
        throw new Error(`Branch document not found: ${branch.rootDocId}`);
    }

    // Swap root doc to point to the branch
    automergeRepository.replaceDoc(DOC_PREFIX_ROOT, branchDoc);

    branchStore.set({ ...state, activeBranchId: branchId });
    projectCrdtToStores();
};

/**
 * Merge a source branch into the current (target) branch.
 */
export const mergeBranch = async (sourceBranchId: string): Promise<void> => {
    const state = branchStore.value;
    if (!state) {
        return;
    }

    const sourceBranch = state.branches.find((b) => b.branchId === sourceBranchId);
    if (!sourceBranch) {
        throw new Error(`Source branch not found: ${sourceBranchId}`);
    }

    const sourceDoc = automergeRepository.getDoc(sourceBranch.rootDocId);
    const targetDoc = automergeRepository.getDoc(DOC_PREFIX_ROOT);

    if (!sourceDoc || !targetDoc) {
        throw new Error('Cannot merge: missing documents');
    }

    const merged = Automerge.merge(targetDoc, sourceDoc);
    automergeRepository.replaceDoc(DOC_PREFIX_ROOT, merged);

    // Persist merged state
    const bundle = automergeRepository.saveAll();
    await saveAllToIdb(bundle);

    projectCrdtToStores();
};

/**
 * Delete a branch. Cannot delete the main branch or the active branch.
 */
export const deleteBranch = (branchId: string): void => {
    if (branchId === MAIN_BRANCH_ID) {
        throw new Error('Cannot delete the main branch');
    }

    const state = branchStore.value;
    if (!state) {
        return;
    }

    if (state.activeBranchId === branchId) {
        throw new Error('Cannot delete the active branch — switch to another branch first');
    }

    const branch = state.branches.find((b) => b.branchId === branchId);
    if (branch) {
        automergeRepository.removeDoc(branch.rootDocId);
    }

    branchStore.set({
        ...state,
        branches: state.branches.filter((b) => b.branchId !== branchId),
    });
};

/**
 * List all branches.
 */
export const listBranches = (): BranchRecord[] => {
    return branchStore.value?.branches ?? [];
};

/**
 * Get the active branch.
 */
export const getActiveBranch = (): BranchRecord | null => {
    const state = branchStore.value;
    if (!state) {
        return null;
    }
    return state.branches.find((b) => b.branchId === state.activeBranchId) ?? null;
};
