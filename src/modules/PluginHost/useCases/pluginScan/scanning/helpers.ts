import { pluginScanStore, defaultPluginScanState } from '../../../stores/pluginScanStore';

export function getState() {
    return pluginScanStore.value ?? defaultPluginScanState;
}
