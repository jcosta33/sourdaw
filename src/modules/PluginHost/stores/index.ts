// PluginHost/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export type { PluginScanState } from './pluginScanStore';
export { pluginScanStore, defaultPluginScanState } from './pluginScanStore';
export type { ExternalPluginActivationState, ExternalPluginActivationStatus } from './externalPluginActivationStore';
export { externalPluginActivationStore, defaultExternalPluginActivationState } from './externalPluginActivationStore';
