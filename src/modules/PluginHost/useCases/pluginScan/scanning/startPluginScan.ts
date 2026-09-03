import { getDefaultPluginPaths } from '../../../repositories/pluginBridge/getDefaultPluginPaths';
import { isScanPathAuthorized } from '../../../repositories/pluginBridge/isScanPathAuthorized';
import { scanPlugins } from '../../../repositories/pluginBridge/scanPlugins';
import { pluginScanStore } from '../../../stores/pluginScanStore';

import { getState } from './helpers';

export type StartPluginScanOptions = {
    /**
     * Clear every quarantine record among this run's candidates before the
     * scan helper runs, giving a binary whose helper previously crashed or
     * timed out one more attempt (#2911). Omitted is the default incremental
     * scan, which skips a quarantined candidate without ever clearing its
     * record.
     */
    readonly retryQuarantined?: boolean;
};

export async function startPluginScan(options: StartPluginScanOptions = {}): Promise<void> {
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

        // Called with one argument by default, matching every call site
        // before this flag existed — existing assertions on the request
        // pin an exact argument list, and a call arity that never changes
        // for an ordinary scan is what keeps that pin meaningful.
        const attempt =
            options.retryQuarantined === true ? await scanPlugins(allPaths, true) : await scanPlugins(allPaths);
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
                // Registry state, not this run's own output: the native side
                // is authoritative for what is quarantined right now, whether
                // this scan reported errors or not.
                quarantined: result.quarantined,
                // A result in hand is a completed enumeration, and a completed
                // enumeration is authoritative for what is installed: the
                // native side answers an incomplete one with a failure the
                // repository throws, and it has already rebuilt the registry
                // activation reads from this very result. A candidate that
                // failed is reported beside the list, never in front of it —
                // withholding the list over one error hid every other plugin
                // the scan found (#3497). A scan that did not run or threw
                // leaves the list alone, above and below. `lastScanTime` dates
                // the list the store holds, so it advances with this write.
                scannedPlugins: result.plugins,
                lastScanTime: Date.now(),
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
