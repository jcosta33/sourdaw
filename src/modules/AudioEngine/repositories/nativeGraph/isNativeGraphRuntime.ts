/**
 * Whether a native graph backend is on the table here at all — the first
 * branch of `probeNativeGraphTransport`, answered without a round trip.
 *
 * A caller that must decide before it can await — the play gesture settles in
 * one turn whether to hold the Web Audio start for the engine — cannot ask the
 * probe itself, because proving the addon answers costs a round trip. This
 * says only that the platform could offer a backend; the probe still decides
 * whether it does.
 */

import { isDesktopRuntime } from '#/utils/desktopBridge';

export function isNativeGraphRuntime(): boolean {
    return isDesktopRuntime();
}
