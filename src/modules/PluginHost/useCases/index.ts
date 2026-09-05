// PluginHost/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { registerBuiltinFaustDSP } from './faustEngine/builtinDSP';

export { registerFaustDSP } from './faustEngine/registerFaustDSP';
export { compileFaustDSP } from './faustEngine/compileFaustDSP';
export { createFaustNode } from './faustEngine/createFaustNode';
export { isFaustModule } from './faustEngine/isFaustModule';
export { getFaustModuleLatencyMs } from './faustEngine/getFaustModuleLatencyMs';
export { isFaustInstrumentModule } from './faustEngine/isFaustInstrumentModule';

export { getPluginHostHandlers } from './getPluginHostHandlers';

export { loadPlugin } from './pluginLifecycle/loadPlugin';
export { unloadPlugin } from './pluginLifecycle/unloadPlugin';
export { openPluginGui } from './pluginLifecycle/openPluginGui';
export { closePluginGui } from './pluginLifecycle/closePluginGui';
export { watchPluginStateDirty } from './pluginLifecycle/watchPluginStateDirty';
// The edit shape stays private: a foreign module derives it from this callable,
// which is the module contract, rather than from a type the use case owns.
export { observeExternalPluginParameterEdits } from './pluginLifecycle/observeExternalPluginParameterEdits';
// The report shape stays private too, for the same reason: a foreign module
// derives it from the sink it registers.
export { registerReleasedStripReportSink } from './pluginLifecycle/registerReleasedStripReportSink';
export { setPluginParameter } from './pluginLifecycle/setPluginParameter';
export { refreshExternalPluginParameters } from './pluginLifecycle/refreshExternalPluginParameters';
export { setPluginBypass } from './pluginLifecycle/setPluginBypass';
export { readPluginState } from './pluginLifecycle/readPluginState';
export { restorePluginState } from './pluginLifecycle/restorePluginState';
export { activateExternalPlugin } from './pluginLifecycle/activateExternalPlugin';
export { markExternalPluginEngineAttached } from './pluginLifecycle/markExternalPluginEngineAttached';
export { clearLoadedExternalPlugins } from './pluginLifecycle/clearLoadedExternalPlugins';
export { resetExternalPluginRuntimeForGraphRebuild } from './pluginLifecycle/resetExternalPluginRuntimeForGraphRebuild';
export { beginProjectSessionPluginRetirement } from './pluginLifecycle/beginProjectSessionPluginRetirement';

export { findPluginByName } from './pluginScan/queries';
export { findSupportedPlugin } from './pluginScan/findSupportedPlugin';
export { resolvePluginEditorCapability } from './pluginScan/resolvePluginEditorCapability';
export { SUPPORTED_PLUGIN_FORMATS, isSupportedPluginFormat } from './pluginScan/supportedPluginFormats';
export { getExternalPluginContractVersionForCommand } from './pluginScan/getExternalPluginContractVersionForCommand';
export { getAgentDeviceFactoryManifest } from './getAgentDeviceFactoryManifest';

export { startPluginScan } from './pluginScan/scanning/startPluginScan';
export { addScanPath } from './pluginScan/scanning/addScanPath';
export { removeScanPath } from './pluginScan/scanning/removeScanPath';
