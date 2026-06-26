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
    pluginScanStore.set({ ...state, isScanning: true, errors: [] });

    try {
        const existingPaths = state.scanPaths;
        const defaultPaths = await getDefaultPluginPaths();
        const allPaths = [...new Set([...existingPaths, ...defaultPaths])];

        if (allPaths.length === 0) {
            pluginScanStore.set({
                ...getState(),
                isScanning: false,
                errors: ['No plugin paths configured'],
            });
            return;
        }

        const result = await scanPlugins(allPaths);
        pluginScanStore.set({
            ...getState(),
            scannedPlugins: result.plugins,
            scanPaths: allPaths,
            isScanning: false,
            lastScanTime: Date.now(),
            errors: result.errors,
        });
    } catch (error) {
        pluginScanStore.set({
            ...getState(),
            isScanning: false,
            errors: [error instanceof Error ? error.message : String(error)],
        });
    }
}
