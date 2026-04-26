import { scanPlugins } from '../../../repositories/pluginBridge/scanPlugins';
import { pluginScanStore } from '../../../stores/pluginScanStore';

import { getState } from './helpers';

export async function scanCustomPaths(paths: string[]): Promise<void> {
    const state = getState();
    pluginScanStore.set({ ...state, isScanning: true, errors: [] });

    try {
        const result = await scanPlugins(paths);
        const existingIds = new Set(state.scannedPlugins.map((param) => param.id));
        const newPlugins = result.plugins.filter((param) => !existingIds.has(param.id));

        pluginScanStore.set({
            ...getState(),
            scannedPlugins: [...state.scannedPlugins, ...newPlugins],
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
