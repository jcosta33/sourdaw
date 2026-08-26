import { getDefaultPluginPaths } from '../../../repositories/pluginBridge/getDefaultPluginPaths';
import { isScanPathAuthorized } from '../../../repositories/pluginBridge/isScanPathAuthorized';
import { pluginScanStore } from '../../../stores/pluginScanStore';

import { getState } from './helpers';

export type AddScanPathOutcome = { added: true } | { added: false; reason: string };

/**
 * Save one scan folder, gated on the policy the scan itself enforces.
 *
 * The policy authorizes only the platform's built-in plugin roots, so a saved
 * path outside them could never be scanned: it would sit in settings and fail
 * every scan with an unauthorized error, permanently. The add asks the policy
 * first and refuses naming the folders that are scannable, so settings holds
 * only paths a scan can honor.
 */
export async function addScanPath(path: string): Promise<AddScanPathOutcome> {
    const state = getState();
    if (state.scanPaths.includes(path)) {
        return { added: true };
    }

    try {
        if (!(await isScanPathAuthorized(path))) {
            const roots = await getDefaultPluginPaths();
            return {
                added: false,
                reason: `${path} cannot be scanned. Plugin scans cover only: ${roots.join(', ')}`,
            };
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { added: false, reason: `Could not verify ${path} can be scanned: ${detail}` };
    }

    // Re-read after the awaited check: the write must not resurrect a state
    // concurrent edits have moved past, and a second add of the same path
    // that raced the first is already-saved, not a duplicate.
    const current = getState();
    if (current.scanPaths.includes(path)) {
        return { added: true };
    }
    pluginScanStore.set({ ...current, scanPaths: [...current.scanPaths, path] });
    return { added: true };
}
