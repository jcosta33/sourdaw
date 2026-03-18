import { pluginScanStore, defaultPluginScanState } from '../stores/pluginScanStore';
import { type ScannedPlugin, scanPlugins, getDefaultPluginPaths } from './pluginBridge';

const getState = () => pluginScanStore.value ?? defaultPluginScanState;

export async function startPluginScan(): Promise<void> {
    const state = getState();
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

export function addScanPath(path: string): void {
    const state = getState();
    if (state.scanPaths.includes(path)) {
        return;
    }
    pluginScanStore.set({ ...state, scanPaths: [...state.scanPaths, path] });
}

export function removeScanPath(path: string): void {
    const state = getState();
    pluginScanStore.set({
        ...state,
        scanPaths: state.scanPaths.filter((p) => p !== path),
    });
}

export function getScannedPlugins(): ScannedPlugin[] {
    return getState().scannedPlugins;
}

export function getScannedPluginsByFormat(format: string): ScannedPlugin[] {
    return getState().scannedPlugins.filter((p) => p.format.toLowerCase() === format.toLowerCase());
}

export function findPluginByName(name: string): ScannedPlugin | undefined {
    const lower = name.toLowerCase();
    return (
        getState().scannedPlugins.find((p) => p.name.toLowerCase() === lower) ??
        getState().scannedPlugins.find((p) => p.name.toLowerCase().includes(lower))
    );
}
