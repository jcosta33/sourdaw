import * as Automerge from '@automerge/automerge';

import { createBranchError } from '../../errors/BranchError';
import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { saveAllToIdb } from '../../repositories/crdtPersistence/saveAllToIdb';
import { branchStore, type BranchRecord } from '../../stores/branchStore';
import { projectCrdtToStores } from '../projection/projectProjection';

/**
 * Fork the current project into a new branch.
 * Uses Automerge.clone() for a fast copy that shares history with the source.
 */
export async function forkProjectBranch(name: string, note = ''): Promise<string> {
    const state = branchStore.value;
    if (!state) {
        throw createBranchError('Branch store not initialized');
    }

    const sourceDoc = automergeRepository.getDoc(DOC_PREFIX_ROOT);
    if (!sourceDoc) {
        throw createBranchError('No root document to fork');
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
}
