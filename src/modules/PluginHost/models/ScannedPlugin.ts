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
     * The identity the plugin's own descriptor claims. Unlike `id`, which is a
     * hash of the current file path, this survives the plugin being moved or
     * reinstalled under a new path. Each format has one — CLAP's reverse-DNS
     * plugin id, VST3's class CID — and it is empty when the scan read no
     * usable descriptor. The host resolves either one, so `id` remains the
     * value to persist.
     */
    descriptor_id: string;
    /**
     * Total audio channels the plugin declared through its own
     * `clap.audio-ports` extension during the scan. Read together with
     * `capability_metadata_reason`: a zero whose reason is present is an
     * unqueried default, not a measured count.
     */
    num_inputs: number;
    /** Total declared output channels. Same provenance as `num_inputs`. */
    num_outputs: number;
    num_parameters: number;
    /**
     * Whether the plugin implements `clap.gui`, the only way a CLAP plugin can
     * offer its own editor. `false` means "not asked" only when
     * `capability_metadata_reason` is the one that covers this field — see
     * that field's own note.
     */
    has_custom_ui: boolean;
    /**
     * Present only when the bounded scanner process created, initialized,
     * inspected, and destroyed a CLAP metadata instance without activation.
     */
    parameters?: ScannedPluginParameter[];
    /** A safe scanner disposition; never a plugin-originated diagnostic payload. */
    parameter_metadata_reason?: string;
    /**
     * Present when any of `num_inputs`, `num_outputs`, or `has_custom_ui` is a
     * default rather than a value the scanner read from the plugin. Absent means
     * all three are queried facts.
     *
     * The reason names which fields it covers, and it is not always all three.
     * "did not inspect this plugin's capability extensions" covers all of them:
     * no instance was inspected. "does not implement clap.audio-ports" covers
     * the two port counts only — an instance was inspected to learn that, so
     * `has_custom_ui` beside it is that instance's own answer and a queried
     * fact. Read the reason, not just its presence, before calling a field
     * unmeasured.
     *
     * A safe scanner disposition; never a plugin-originated diagnostic payload.
     */
    capability_metadata_reason?: string;
};
