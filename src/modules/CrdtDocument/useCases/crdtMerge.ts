import * as Automerge from '@automerge/automerge';

import { type DocumentBundle, type MergeResult, DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';
import { projectCrdtToStores } from './projection/projectProjection';
import { persistCrdtProject } from './crdtProjectLifecycle';
import { forkProjectBranch } from './crdtBranching';
import { decodeSdawFile, encodeSdawFile } from './sdawFileFormat';

const mergeDocumentBundleFromRepo = (bundle: DocumentBundle) => automergeRepository.mergeBundle(bundle);

export type ImportDecision = 'merge' | 'branch' | 'separate';

/**
 * Determine how to import a bundle based on shared lineage.
 *
 * - `merge`: same project lineage — merge directly
 * - `branch`: related but diverged — import as a branch
 * - `separate`: unrelated project — open separately
 */
export const detectImportDecision = (bundle: DocumentBundle): ImportDecision => {
    const incomingRootBytes = bundle.get(DOC_PREFIX_ROOT);
    if (!incomingRootBytes) {
        return 'separate';
    }

    const localDoc = automergeRepository.getDoc(DOC_PREFIX_ROOT);
    if (!localDoc) {
        return 'separate';
    }

    // Check if the incoming doc shares lineage by attempting a trial merge.
    // If the merge produces more changes than either doc alone, they share history.
    try {
        const incomingDoc = Automerge.load(incomingRootBytes);

        // Trial merge on a clone — doesn't modify the real doc
        const trialDoc = Automerge.clone(localDoc);
        const merged = Automerge.merge(trialDoc, incomingDoc);

        const localChangeCount = Automerge.getAllChanges(localDoc).length;
        const incomingChangeCount = Automerge.getAllChanges(incomingDoc).length;
        const mergedChangeCount = Automerge.getAllChanges(merged).length;

        // If merged has fewer changes than the sum, they share some history
        if (mergedChangeCount < localChangeCount + incomingChangeCount) {
            return 'merge';
        }

        // No shared history — completely independent documents
        return 'separate';
    } catch {
        return 'separate';
    }
};

export async function importSdawFile(file: File): Promise<MergeResult | null> {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const bundle = decodeSdawFile(bytes);

        const decision = detectImportDecision(bundle);

        if (decision === 'separate') {
            return null;
        }

        if (decision === 'branch') {
            await forkProjectBranch(`Import ${file.name}`);
        }

        const result = await mergeDocumentBundleFromRepo(bundle);
        projectCrdtToStores();

        await persistCrdtProject();
        return result;
    } catch (error) {
        console.error('[CrdtMerge] Failed to import .sdaw file:', error);
        return null;
    }
}

/**
 * Export the current project as an .sdaw binary blob.
 */
export const exportSdawFile = (): Blob => {
    const bundle = automergeRepository.saveAll();
    const bytes = encodeSdawFile(bundle);
    return new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
};

export async function mergeDocumentBundle(bundle: DocumentBundle): Promise<MergeResult> {
    const result = await mergeDocumentBundleFromRepo(bundle);
    projectCrdtToStores();
    await persistCrdtProject();
    return result;
}
