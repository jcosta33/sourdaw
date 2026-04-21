import { pluginScanStore, defaultPluginScanState, type ScannedPlugin } from '../../stores/pluginScanStore';

export type { ScannedPlugin } from '../../stores/pluginScanStore';

function getState() {
    return pluginScanStore.value ?? defaultPluginScanState;
}

export function findPluginByName(name: string): ScannedPlugin | undefined {
    const lower = name.toLowerCase();
    return (
        getState().scannedPlugins.find((p) => p.name.toLowerCase() === lower) ??
        getState().scannedPlugins.find((p) => p.name.toLowerCase().includes(lower))
    );
}
