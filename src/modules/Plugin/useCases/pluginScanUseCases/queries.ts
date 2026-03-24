import { pluginScanStore, defaultPluginScanState } from '#/modules/AudioEngine/stores/pluginScanStore';
import { type ScannedPlugin } from '../../repositories/pluginBridge';

const getState = () => pluginScanStore.value ?? defaultPluginScanState;

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
