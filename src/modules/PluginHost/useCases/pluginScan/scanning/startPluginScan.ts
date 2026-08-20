import { getDefaultPluginPaths } from '../../../repositories/pluginBridge/getDefaultPluginPaths';
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
        const allPaths = [...new Set([...scanPathsBeforeScan, ...defaultPaths])];

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
                notices: result.notices,
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
