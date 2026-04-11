// Plugin/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { registerBuiltinFaustDSP } from './faustEngine/builtinDSP';

export {
    getFaustCompilerError,
    isFaustCompilerReady,
    registerFaustDSP,
    compileFaustDSP,
    compileAllFaustModules,
    createFaustNode,
    getFaustModules,
    getFaustModule,
    isFaustModule,
} from './faustEngine/compilerEngine';
export type { FaustModule, FaustParamDescriptor } from './faustEngine/compilerEngine';

export type { ModulatorPreset } from './modulatorLibrary';
export { MODULATOR_PRESETS } from './modulatorLibrary';

export { toggleNodeView } from './nodeView/toggleNodeView';

export { createTrackForPlugin, loadExternalPlugin } from './pluginBrowserActions';

export { getPluginHostHandlers } from './getPluginHostHandlers';

export { loadPlugin, unloadPlugin, processAudioIPC, openPluginGui, closePluginGui } from './pluginLifecycle';

export { MIDI_EFFECT_FACTORIES } from './pluginQueries';

export { findPluginByName } from './pluginScan/queries';
export type { ScannedPlugin } from './pluginScan/queries';

export { startPluginScan, scanCustomPaths, addScanPath, removeScanPath } from './pluginScan/scanning';

export { registerProModulationEffects } from './proModulationEffects';

export { connectPush } from './pushIntegration/connectPush';

export { disconnectPush } from './pushIntegration/disconnectPush';

export { registerBuiltinPlugins } from './wamPluginHost/builtinDescriptors';

export type { WAMDescriptor, WAMInstance } from './wamPluginHost/hostOperations';
export {
    initWAMEnvironment,
    registerWAMPlugin,
    getRegisteredPlugins,
    getPluginsByCategory,
    loadWAMPlugin,
    unloadWAMPlugin,
    getActiveInstances,
} from './wamPluginHost/hostOperations';
