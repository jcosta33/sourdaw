/**
 * Whether the native engine compensates a device type's own group delay where
 * it carries the strip (#4153).
 *
 * The registry states it per body (`latencyCompensatedByEngine`, mirroring
 * `PluginCore::declared_latency_frames` in `crates/daw-engine/src/scheduler.rs`);
 * this is the reading the renderer's compensation asks. A device type with no
 * native body answers `false`: nothing the engine does not host can be
 * compensated by it, so every Web Audio-only built-in keeps costing its own
 * reported figure.
 */

import { nativeBuiltinBody } from './nativeBuiltinBodies';

export function isLatencyCompensatedByEngine(deviceType: string): boolean {
    return nativeBuiltinBody(deviceType)?.latencyCompensatedByEngine ?? false;
}
