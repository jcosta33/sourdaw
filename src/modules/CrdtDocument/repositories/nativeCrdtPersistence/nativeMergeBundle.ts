import { invokeCommand } from './invokeCommand';

/** Merge an external .sdaw bundle into the current project. */
export async function nativeMergeBundle(path: string): Promise<{ mergedDocIds: string[]; newDocIds: string[] } | null> {
    const result = await invokeCommand('collab_merge_bundle', { path });
    if (!result || typeof result !== 'object') {
        return null;
    }
    return result as { mergedDocIds: string[]; newDocIds: string[] };
}
