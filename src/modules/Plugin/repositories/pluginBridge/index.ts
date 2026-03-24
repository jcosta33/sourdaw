// Types
export type {
    ScannedPlugin,
    PluginParameter,
    PluginInstance,
    ScanResult,
    PluginGuiInfo,
} from './types';

// Plugin scanning
export { scanPlugins } from './scanPlugins';
export { getDefaultPluginPaths } from './getDefaultPluginPaths';

// Plugin lifecycle
export { loadPlugin } from './loadPlugin';
export { unloadPlugin } from './unloadPlugin';

// Parameters & state
export { setPluginParameter } from './setPluginParameter';
export { getPluginParameters } from './getPluginParameters';
export { getPluginState } from './getPluginState';
export { setPluginState } from './setPluginState';

// Audio IPC
export { processAudioIPC } from './processAudioIPC';

// Plugin GUI
export { isPluginGuiSupported } from './isPluginGuiSupported';
export { openPluginGui } from './openPluginGui';
export { closePluginGui } from './closePluginGui';

// Re-export Tauri availability check
export { isTauri as isTauriAvailable } from '#/helpers/tauriBridge';
