import { scanPlugins } from '../../../repositories/pluginBridge/scanPlugins';
import { pluginScanStore } from '../../../stores/pluginScanStore';

import { getState } from './helpers';

export async function scanCustomPaths(paths: string[]): Promise<void> {
    const state = getState();
    // In-flight guard: a scan already running owns the store. A second start
    // would race the first's awaited completion and overwrite its result
    // (last-writer-wins on scannedPlugins/scanPaths/isScanning).
    if (state.isScanning) {
        return;
    }
    pluginScanStore.set({ ...state, isScanning: true, errors: [], notices: [] });

    try {
        const result = await scanPlugins(paths);
        pluginScanStore.update((current) => {
            const currentState = current ?? getState();
            const existingIds = new Set(currentState.scannedPlugins.map((plugin) => plugin.id));
            const newPlugins = result.plugins.filter((plugin) => !existingIds.has(plugin.id));

            return {
                ...currentState,
                scannedPlugins: [...currentState.scannedPlugins, ...newPlugins],
                isScanning: false,
                lastScanTime: Date.now(),
                errors: result.errors,
                notices: result.notices,
            };
        });
    } catch (error) {
        pluginScanStore.update((current) => ({
            ...(current ?? getState()),
            isScanning: false,
            errors: [error instanceof Error ? error.message : String(error)],
            notices: [],
        }));
    }
}
