/**
 * Plugin bridge types — DTOs for native plugin IPC.
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
    /**
     * Raw CLAP latency in frames of the rate the plugin was activated with (the
     * native device rate). Informational only — this process does not share that
     * clock, so converting it here would mis-scale. Use `latency_ms`.
     */
    latency_samples: number;
    /** Latency in milliseconds, converted host-side at the activation sample rate. */
    latency_ms: number;
    /**
     * The id this instance was given inside the native audio engine, or `null`
     * when the load succeeded but no engine was running to attach it to.
     *
     * `null` is a degraded load, not a failure: the plugin is instantiated and
     * its state is restorable, but it is in no rendering graph, so it processes
     * no audio until it is loaded again against a running engine. Loading before
     * `start_native_engine` is a legitimate flow, which is why the host returns
     * success — this field is how a caller tells the two apart.
     */
    engine_plugin_id: number | null;
};

/**
 * Payload of the `plugin-latency-changed` event: a native plugin reported a new
 * latency mid-session (it called `clap_host_latency.changed()` or
 * `request_restart()`, and the host re-queried it after a reactivation).
 */
export type PluginLatencyChange = {
    instance_id: string;
    /** Already converted host-side; see `PluginInstance.latency_ms`. */
    latency_ms: number;
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
