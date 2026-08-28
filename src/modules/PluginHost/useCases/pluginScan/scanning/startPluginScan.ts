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

        const attempt = await scanPlugins(allPaths);
        if (!attempt.ran) {
            // No scan ran, so there is no result to apply: everything a scan
            // restates — the plugin list, the paths it merged, the time it
            // finished — stays as it is, and the reason reaches the error
            // channel the scan UI already renders.
            pluginScanStore.update((current) => ({
                ...(current ?? getState()),
                isScanning: false,
                errors: [attempt.reason],
                notices: [],
            }));
            return;
        }
        const { result } = attempt;
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
                errors: result.errors,
                notices: [...refusedPathNotice, ...result.notices],
                // The native contract calls a non-empty error list "a scan the
                // user has a problem with". That scan's `plugins` is the
                // partial output of a failed run — writing it would drop every
                // plugin under a root that failed to read, which is the wipe
                // this guards against — so a failed scan leaves the list alone
                // and reports why. Only a clean enumeration restates the list,
                // and a clean empty one is a valid result, not a wipe.
                // `lastScanTime` dates the list the store holds, so it advances
                // with that write and not with the attempt.
                ...(result.errors.length > 0 ? {} : { scannedPlugins: result.plugins, lastScanTime: Date.now() }),
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
