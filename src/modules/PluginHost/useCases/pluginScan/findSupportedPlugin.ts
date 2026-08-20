import { type ScannedPlugin } from '../../models/ScannedPlugin';
import { defaultPluginScanState, pluginScanStore } from '../../stores/pluginScanStore';

import { isSupportedPluginFormat } from './supportedPluginFormats';

export function findSupportedPlugin(reference: string): ScannedPlugin | undefined {
    const normalizedReference = reference.trim().toLowerCase();
    const state = pluginScanStore.value ?? defaultPluginScanState;

    return state.scannedPlugins.find(
        (plugin) =>
            isSupportedPluginFormat(plugin.format) &&
            (plugin.id === reference ||
                plugin.descriptor_id === reference ||
                plugin.name.toLowerCase() === normalizedReference)
    );
}
