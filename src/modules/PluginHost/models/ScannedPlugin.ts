/**
 * A plugin discovered by the native `scan_plugins` command.
 *
 * Single source of truth for the scanned-plugin shape: the bridge DTO
 * (`repositories/pluginBridge/types.ts`) and the scan store
 * (`stores/pluginScanStore.ts`) both reference this model so the store write
 * in `startPluginScan` cannot drift from the DTO it persists. Field names are
 * snake_case because this mirrors the serialized Rust payload verbatim.
 */
export type ScannedPlugin = {
    id: string;
    name: string;
    vendor: string;
    format: string;
    category: string;
    path: string;
    version: string;
    num_inputs: number;
    num_outputs: number;
    num_parameters: number;
    has_custom_ui: boolean;
};
