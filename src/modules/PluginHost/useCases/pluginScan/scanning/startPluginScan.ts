import { getDefaultPluginPaths } from '../../../repositories/pluginBridge/getDefaultPluginPaths';
import { isScanPathAuthorized } from '../../../repositories/pluginBridge/isScanPathAuthorized';
import { scanPlugins } from '../../../repositories/pluginBridge/scanPlugins';
import { pluginScanStore } from '../../../stores/pluginScanStore';

import { getState } from './helpers';

export async function startPluginScan(): Promise<void> {
    const state = getState();
    // In-flight guard: a scan already running owns the store. A second start
    // would race the first's awaited completion and overwrite its result
    // (last-writer-wins on scannedPlugins/scanPaths/isScanning).
    if (state.isScanning) {
        return;
    }
    pluginScanStore.set({ ...state, isScanning: true, errors: [], notices: [] });

    try {
        const defaultPaths = await getDefaultPluginPaths();
        const scanPathsBeforeScan = getState().scanPaths;
        // Saved paths the policy refuses are left out of the request rather
        // than sent to fail: a path saved before the add was policy-gated
        // comes back from the native scan as an unauthorized error on every
        // run — red, destructive, and never fixable from the scan itself.
        // They are named once, on the notice channel, and stay in settings
        // for the user to remove. A query that fails aborts the scan: the
        // partition decides what gets scanned, and guessing either way would
        // silently skip or silently send a path.
        const authorizations = await Promise.all(
            scanPathsBeforeScan.map(async (scan_path) => ({
                path: scan_path,
                authorized: await isScanPathAuthorized(scan_path),
            }))
        );
        const refusedPaths = authorizations
            .filter((authorization) => !authorization.authorized)
            .map((authorization) => authorization.path);
        const authorizedScanPaths = authorizations
            .filter((authorization) => authorization.authorized)
            .map((authorization) => authorization.path);
        const allPaths = [...new Set([...authorizedScanPaths, ...defaultPaths])];

        if (allPaths.length === 0) {
            pluginScanStore.update((current) => ({
                ...(current ?? getState()),
                isScanning: false,
                errors: ['No plugin paths configured'],
                notices: [],
            }));
            return;
        }

        const result = await scanPlugins(allPaths);
        const refusedPathNotice =
            refusedPaths.length > 0
                ? [
                      `Skipped ${refusedPaths.length} saved scan path(s) the app is not allowed to scan: ${refusedPaths.join(', ')}`,
                  ]
                : [];
        pluginScanStore.update((current) => {
            const currentState = current ?? getState();
            const removedScanPaths = new Set(
                scanPathsBeforeScan.filter((scan_path) => !currentState.scanPaths.includes(scan_path))
            );
            const scanPaths = [...new Set([...currentState.scanPaths, ...defaultPaths])].filter(
                (scan_path) => !removedScanPaths.has(scan_path)
            );

            return {
                ...currentState,
                scanPaths,
                isScanning: false,
                lastScanTime: Date.now(),
                errors: result.errors,
                notices: [...refusedPathNotice, ...result.notices],
                scannedPlugins: result.plugins,
            };
        });
    } catch (error) {
        pluginScanStore.update((current) => ({
            ...(current ?? getState()),
            isScanning: false,
            errors: [error instanceof Error ? error.message : String(error)],
            // The scan produced no result, so it has nothing to say beyond the
            // failure. Carrying the previous run's notices forward would
            // attribute them to a scan that never reported anything.
            notices: [],
        }));
    }
}
