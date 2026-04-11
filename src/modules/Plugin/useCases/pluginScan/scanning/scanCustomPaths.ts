import { pluginScanStore } from '../../../stores/pluginScanStore';
import { scanPlugins } from '../../../repositories/pluginBridge/scanPlugins';
import { getState } from './helpers';

export async function scanCustomPaths(paths: string[]): Promise<void> {
    const state = getState();
    pluginScanStore.set({ ...state, isScanning: true, errors: [] });

    try {
        const result = await scanPlugins(paths);
        const existingIds = new Set(state.scannedPlugins.map((p) => p.id));
        const newPlugins = result.plugins.filter((p) => !existingIds.has(p.id));

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