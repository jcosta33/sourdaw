import { pluginScanStore } from '#/modules/PluginHost/stores';

import { type HostedPluginKind } from './nativeOfflineHostedDevice';

/** The scan's own split, mirrored from `chain_kind_for_category`. */
export function readScannedPluginKind(externalPluginId: string): HostedPluginKind | null {
    const plugin = pluginScanStore.value?.scannedPlugins.find((candidate) => candidate.id === externalPluginId);
    if (!plugin) {
        return null;
    }
    return plugin.category === 'instrument' ? 'instrument' : 'effect';
}
