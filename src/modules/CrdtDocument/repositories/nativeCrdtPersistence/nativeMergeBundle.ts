import { invokeCommand } from './helpers';

/** Merge an external .sdaw bundle into the current project. */
export const nativeMergeBundle = async (
    path: string
): Promise<{ mergedDocIds: string[]; newDocIds: string[] } | null> => {
    const result = await invokeCommand('collab_merge_bundle', { path });
    if (!result || typeof result !== 'object') {
        return null;
    }
    return result as { mergedDocIds: string[]; newDocIds: string[] };
};
