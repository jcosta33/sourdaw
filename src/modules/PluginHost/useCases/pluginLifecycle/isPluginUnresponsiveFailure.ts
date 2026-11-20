/**
 * The start of every refusal the native host gives for an instance it found
 * unresponsive: a vendor call that never returned held the instance's control
 * gate past its deadline (`unresponsive_control_error` in
 * `crates/sourdaw-native/src/host/native_bridge.rs`, the one producer). The
 * desktop bridge wraps a native error's message in its own text, so the marker
 * is looked for inside the reason rather than at its start.
 */
const PLUGIN_UNRESPONSIVE_MARKER = 'plugin-unresponsive:';

export function isPluginUnresponsiveFailure(reason: string): boolean {
    return reason.includes(PLUGIN_UNRESPONSIVE_MARKER);
}
