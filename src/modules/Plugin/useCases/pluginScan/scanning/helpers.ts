import { pluginScanStore, defaultPluginScanState } from '../../../stores/pluginScanStore';
export const getState = () => pluginScanStore.value ?? defaultPluginScanState;