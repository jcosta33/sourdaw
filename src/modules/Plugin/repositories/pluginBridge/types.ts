/**
 * Plugin bridge types — DTOs for Tauri plugin IPC.
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

export type PluginParameter = {
    id: number;
    name: string;
    value: number;
    default_value: number;
    min_value: number;
    max_value: number;
    unit: string;
    is_automatable: boolean;
};

export type PluginInstance = {
    instance_id: string;
    plugin_id: string;
    name: string;
    parameters: PluginParameter[];
    is_active: boolean;
    latency_samples: number;
};

export type ScanResult = {
    plugins: ScannedPlugin[];
    errors: string[];
    scan_duration_ms: number;
};

export type PluginGuiInfo = {
    has_gui: boolean;
    is_open: boolean;
    width: number;
    height: number;
};
