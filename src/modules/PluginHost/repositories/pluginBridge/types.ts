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
     * Raw CLAP latency in frames of the rate the plugin was activated with —
     * the engine rate the caller supplied. Informational only: the value is
     * reported again over the latency-change event, from a path with no caller
     * to ask, so `latency_ms` is the one figure compensation reads.
     */
    latency_samples: number;
    /** Latency in milliseconds, converted host-side at the activation sample rate. */
    latency_ms: number;
    /**
     * Frames the native audio bridge adds on top of `latency_ms`, at the
     * activation sample rate. Zero when no engine took the instance — nothing
     * crosses a bridge that does not exist.
     *
     * The host measures this against the device period its audio callback
     * actually runs on, which this process never sees; it is reported for that
     * reason and cannot be derived here.
     *
     * Temporary, with the bridge: jcosta33/sourdaw#2230 replaces the worklet
     * relay with the native graph, and this field goes with it.
     */
    bridge_round_trip_frames: number;
    /**
     * The id this instance was given inside the native audio engine, or `null`
     * when the load succeeded but no engine was running to attach it to.
     *
     * `null` is a degraded load, not a failure: the plugin is instantiated and
     * its state is restorable, but it is in no rendering graph, so it processes
     * no audio until it is loaded again against a running engine. The engine
     * starts lazily on the first `apply_graph_commands` batch, so loading a
     * plugin before it runs is a legitimate flow, which is why the host returns
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
    /** What went wrong: an unreadable root, a failed candidate, a safety limit. */
    errors: string[];
    /**
     * What the scan wants the user to know about a run that did not go wrong —
     * today, the reason a recognised plugin format is not loaded.
     *
     * Separate from `errors` because a refused format's folders are scanned
     * like any other: on the error channel, a user who owns one plugin in a
     * format Sourdaw does not host would see every scan report as failed.
     */
    notices: string[];
    scan_duration_ms: number;
};

export type PluginGuiInfo = {
    has_gui: boolean;
    is_open: boolean;
    width: number;
    height: number;
};
