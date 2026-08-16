// PluginHost/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { registerBuiltinFaustDSP } from './faustEngine/builtinDSP';

export { registerFaustDSP } from './faustEngine/registerFaustDSP';
export { compileFaustDSP } from './faustEngine/compileFaustDSP';
export { createFaustNode } from './faustEngine/createFaustNode';
export { isFaustModule } from './faustEngine/isFaustModule';
export { isFaustInstrumentModule } from './faustEngine/isFaustInstrumentModule';

export { getPluginHostHandlers } from './getPluginHostHandlers';

export { loadPlugin } from './pluginLifecycle/loadPlugin';
export { unloadPlugin } from './pluginLifecycle/unloadPlugin';
export { openPluginGui } from './pluginLifecycle/openPluginGui';
export { processAudioIPC } from './pluginLifecycle/processAudioIPC';
export { setPluginParameter } from './pluginLifecycle/setPluginParameter';
export { setPluginBypass } from './pluginLifecycle/setPluginBypass';
export { readPluginState } from './pluginLifecycle/readPluginState';
export { restorePluginState } from './pluginLifecycle/restorePluginState';
export { activateExternalPlugin } from './pluginLifecycle/activateExternalPlugin';
export { clearLoadedExternalPlugins } from './pluginLifecycle/clearLoadedExternalPlugins';

export { findPluginByName } from './pluginScan/queries';
export { findSupportedPlugin } from './pluginScan/findSupportedPlugin';
export { getExternalPluginContractVersionForCommand } from './pluginScan/getExternalPluginContractVersionForCommand';

export { startPluginScan } from './pluginScan/scanning/startPluginScan';
export { addScanPath } from './pluginScan/scanning/addScanPath';
export { removeScanPath } from './pluginScan/scanning/removeScanPath';

export { registerProModulationEffects } from './proModulationEffects';

export { registerBuiltinPlugins } from './wamPluginHost/builtinDescriptors';

export { initWAMEnvironment } from './wamPluginHost/hostOperations/initWAMEnvironment';
export { registerWAMPlugin } from './wamPluginHost/hostOperations/registerWAMPlugin';
export { getRegisteredPlugins } from './wamPluginHost/hostOperations/getRegisteredPlugins';
export { getPluginsByCategory } from './wamPluginHost/hostOperations/getPluginsByCategory';
export { loadWAMPlugin } from './wamPluginHost/hostOperations/loadWAMPlugin';
export { unloadWAMPlugin } from './wamPluginHost/hostOperations/unloadWAMPlugin';
export { getActiveInstances } from './wamPluginHost/hostOperations/getActiveInstances';
