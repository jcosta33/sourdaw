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

export { toggleNodeView } from './nodeView/toggleNodeView';

export { getPluginHostHandlers } from './getPluginHostHandlers';

export { loadPlugin } from './pluginLifecycle/loadPlugin';
export { unloadPlugin } from './pluginLifecycle/unloadPlugin';
export { processAudioIPC } from './pluginLifecycle/processAudioIPC';
export { openPluginGui } from './pluginLifecycle/openPluginGui';
export { closePluginGui } from './pluginLifecycle/closePluginGui';

export { MIDI_EFFECT_FACTORIES } from './pluginQueries';

export { findPluginByName } from './pluginScan/queries';
export type { ScannedPlugin } from './pluginScan/queries';

export { startPluginScan } from './pluginScan/scanning/startPluginScan';
export { scanCustomPaths } from './pluginScan/scanning/scanCustomPaths';
export { addScanPath } from './pluginScan/scanning/addScanPath';
export { removeScanPath } from './pluginScan/scanning/removeScanPath';

export { registerProModulationEffects } from './proModulationEffects';

export { connectPush } from './pushIntegration/connectPush';

export { disconnectPush } from './pushIntegration/disconnectPush';

export { registerBuiltinPlugins } from './wamPluginHost/builtinDescriptors';

export { registerChamberInstance } from './proofChamber/registerChamberInstance';
export { updateChamberEngine } from './proofChamber/updateChamberEngine';
export { setChamberUILevel } from './proofChamber/setChamberUILevel';

export type { WAMDescriptor, WAMInstance } from './wamPluginHost/hostOperations/helpers';
export { initWAMEnvironment } from './wamPluginHost/hostOperations/initWAMEnvironment';
export { registerWAMPlugin } from './wamPluginHost/hostOperations/registerWAMPlugin';
export { getRegisteredPlugins } from './wamPluginHost/hostOperations/getRegisteredPlugins';
export { getPluginsByCategory } from './wamPluginHost/hostOperations/getPluginsByCategory';
export { loadWAMPlugin } from './wamPluginHost/hostOperations/loadWAMPlugin';
export { unloadWAMPlugin } from './wamPluginHost/hostOperations/unloadWAMPlugin';
export { getActiveInstances } from './wamPluginHost/hostOperations/getActiveInstances';
