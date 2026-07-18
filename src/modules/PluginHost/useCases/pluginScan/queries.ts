import { type ScannedPlugin } from '../../models/ScannedPlugin';
import { pluginScanStore, defaultPluginScanState } from '../../stores/pluginScanStore';

function getState() {
    return pluginScanStore.value ?? defaultPluginScanState;
}

export function findPluginByName(name: string): ScannedPlugin | undefined {
    const lower = name.toLowerCase();
    return (
        getState().scannedPlugins.find((param) => param.name.toLowerCase() === lower) ??
        getState().scannedPlugins.find((param) => param.name.toLowerCase().includes(lower))
    );
}
