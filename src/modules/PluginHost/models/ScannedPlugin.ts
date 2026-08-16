/**
 * A plugin discovered by the native `scan_plugins` command.
 *
 * Single source of truth for the scanned-plugin shape: the bridge DTO
 * (`repositories/pluginBridge/types.ts`) and the scan store
 * (`stores/pluginScanStore.ts`) both reference this model so the store write
 * in `startPluginScan` cannot drift from the DTO it persists. Field names are
 * snake_case because this mirrors the serialized Rust payload verbatim.
 */
export type ScannedPluginParameter = {
    id: number;
    name: string;
    module?: string;
    min_value: number;
    max_value: number;
    default_value: number;
    is_automatable: boolean;
    is_modulatable: boolean;
    is_stepped: boolean;
    is_enum: boolean;
};

export type ScannedPlugin = {
    id: string;
    name: string;
    vendor: string;
    format: string;
    category: string;
    path: string;
    version: string;
    /**
     * The plugin's own CLAP descriptor id. Unlike `id`, which is a hash of the
     * current file path, this survives the plugin being moved or reinstalled
     * under a new path. Empty for formats with no CLAP descriptor (VST3, AU).
     * The host resolves either one, so `id` remains the value to persist.
     */
    clap_id: string;
    num_inputs: number;
    num_outputs: number;
    num_parameters: number;
    has_custom_ui: boolean;
    /**
     * Present only when the bounded scanner process created, initialized,
     * inspected, and destroyed a CLAP metadata instance without activation.
     */
    parameters?: ScannedPluginParameter[];
    /** A safe scanner disposition; never a plugin-originated diagnostic payload. */
    parameter_metadata_reason?: string;
};
