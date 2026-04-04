/**
 * TEMPORARY MIGRATION SHIM
 *
 * Plugin scan state has moved to Plugin/stores/pluginScanStore.
 * The Plugin module owns scan state — it initiates and writes all scan operations.
 *
 * This shim preserves the legacy import path used by:
 *   - Workspace/presentations/views/Inspector/TrackDevicesSection
 *   - AudioEngine/presentations/views/PluginBrowser
 *   - AudioEngine/presentations/views/PluginScanSettings
 *
 * Remove after the global import convergence pass.
 */
export {
    pluginScanStore,
    defaultPluginScanState,
    type PluginScanState,
} from '#/modules/Plugin/stores/pluginScanStore';
