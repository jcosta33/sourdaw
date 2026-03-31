import { importSdawFile } from './crdtMerge';
import { persistCrdtProject } from './crdtProjectLifecycle';
import { projectCrdtToStores } from './projection/projectProjection';

export type MergeOnOpenResult = {
    success: boolean;
    tracksAdded: number;
    documentsMerged: number;
    documentsNew: number;
    error?: string;
};

/**
 * Merge an external .sdaw file into the currently loaded project.
 * This is the "merge-on-open" workflow for async collaboration.
 *
 * 1. Decode the .sdaw file
 * 2. Merge each document (Automerge handles conflict resolution)
 * 3. Persist the merged state
 * 4. Re-project to stores
 */
export const mergeExternalProject = async (file: File): Promise<MergeOnOpenResult> => {
    try {
        const mergeResult = await importSdawFile(file);

        if (!mergeResult) {
            return {
                success: false,
                tracksAdded: 0,
                documentsMerged: 0,
                documentsNew: 0,
                error: 'Failed to import file. It may not be a valid .sdaw file.',
            };
        }

        const tracksAdded = mergeResult.newDocIds.filter((id) => id.startsWith('track_')).length;

        // Re-project the merged state to all stores
        projectCrdtToStores();

        // Persist the merged result
        await persistCrdtProject();

        return {
            success: true,
            tracksAdded,
            documentsMerged: mergeResult.mergedDocIds.length,
            documentsNew: mergeResult.newDocIds.length,
        };
    } catch (error) {
        return {
            success: false,
            tracksAdded: 0,
            documentsMerged: 0,
            documentsNew: 0,
            error: String(error),
        };
    }
};
