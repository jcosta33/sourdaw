/**
 * Plugin bridge types — DTOs for Tauri plugin IPC.
 */

import { type ScannedPlugin } from '../../models/ScannedPlugin';

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
    engine_plugin_id: number | null;
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
