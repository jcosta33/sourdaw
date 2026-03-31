import { type DocumentBundle, type MergeResult } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';
import { persistCrdtProject } from './crdtProjectLifecycle';
import { decodeSdawFile, encodeSdawFile } from './sdawFileFormat';

/**
 * Import an .sdaw file and merge its contents into the current project.
 * Returns a merge result summary, or null if import fails.
 */
export const importSdawFile = async (file: File): Promise<MergeResult | null> => {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const bundle = decodeSdawFile(bytes);

        const result = automergeRepository.mergeBundle(bundle);
        await persistCrdtProject();

        return result;
    } catch (error) {
        console.error('[CrdtMerge] Failed to import .sdaw file:', error);
        return null;
    }
};

/**
 * Export the current project as an .sdaw binary blob.
 */
export const exportSdawFile = (): Blob => {
    const bundle = automergeRepository.saveAll();
    const bytes = encodeSdawFile(bundle);
    return new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
};

/**
 * Merge a document bundle into the current project.
 */
export const mergeDocumentBundle = async (bundle: DocumentBundle): Promise<MergeResult> => {
    const result = automergeRepository.mergeBundle(bundle);
    await persistCrdtProject();
    return result;
};
