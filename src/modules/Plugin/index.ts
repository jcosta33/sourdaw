// Plugin module public API

// stores
export type { PluginScanState } from './stores/pluginScanStore';
export { pluginScanStore, defaultPluginScanState } from './stores/pluginScanStore';

// faustEngine/builtinDSP
export { registerBuiltinFaustDSP } from './useCases/faustEngine/builtinDSP';

// faustEngine/compilerEngine
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
} from './useCases/faustEngine/compilerEngine';
export type { FaustModule, FaustParamDescriptor } from './useCases/faustEngine/compilerEngine';

// modulatorLibrary
export type { ModulatorPreset } from './useCases/modulatorLibrary';
export { MODULATOR_PRESETS } from './useCases/modulatorLibrary';

// nodeView/toggleNodeView
export { toggleNodeView } from './useCases/nodeView/toggleNodeView';

// pluginBrowserActions
export { createTrackForPlugin, loadExternalPlugin } from './useCases/pluginBrowserActions';

// pluginHostHandlers
export { pluginHostHandlers } from './useCases/pluginHostHandlers';

// pluginLifecycle
export { loadPlugin, unloadPlugin, processAudioIPC, openPluginGui, closePluginGui } from './useCases/pluginLifecycle';

// pluginQueries
export { MIDI_EFFECT_FACTORIES } from './useCases/pluginQueries';

// pluginScan/queries
export { findPluginByName } from './useCases/pluginScan/queries';
export type { ScannedPlugin } from './useCases/pluginScan/queries';

// pluginScan/scanning
export { startPluginScan, scanCustomPaths, addScanPath, removeScanPath } from './useCases/pluginScan/scanning';

// proModulationEffects
export { registerProModulationEffects } from './useCases/proModulationEffects';

// pushIntegration/connectPush
export { connectPush } from './useCases/pushIntegration/connectPush';

// pushIntegration/disconnectPush
export { disconnectPush } from './useCases/pushIntegration/disconnectPush';

// wamPluginHost/builtinDescriptors
export { registerBuiltinPlugins } from './useCases/wamPluginHost/builtinDescriptors';

// wamPluginHost/hostOperations
export type { WAMDescriptor, WAMInstance } from './useCases/wamPluginHost/hostOperations';
export {
    initWAMEnvironment,
    registerWAMPlugin,
    getRegisteredPlugins,
    getPluginsByCategory,
    loadWAMPlugin,
    unloadWAMPlugin,
    getActiveInstances,
} from './useCases/wamPluginHost/hostOperations';
