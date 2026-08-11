import { type ScannedPlugin } from '../../models/ScannedPlugin';
import { defaultPluginScanState, pluginScanStore } from '../../stores/pluginScanStore';

export function findSupportedPlugin(reference: string): ScannedPlugin | undefined {
    const normalizedReference = reference.trim().toLowerCase();
    const state = pluginScanStore.value ?? defaultPluginScanState;

    return state.scannedPlugins.find(
        (plugin) =>
            plugin.format.toLowerCase() === 'clap' &&
            (plugin.id === reference ||
                plugin.clap_id === reference ||
                plugin.name.toLowerCase() === normalizedReference)
    );
}
