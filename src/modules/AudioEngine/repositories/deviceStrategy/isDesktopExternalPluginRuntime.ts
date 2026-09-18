/**
 * Whether this process is the desktop runtime, for the offline plugin
 * refusal's own gate (#4355).
 *
 * `buildDeviceChain` cannot call `#/utils/desktopBridge` directly —
 * `desktop-ipc-only-in-repositories` restricts that import to module-root
 * repositories — so this thin wrapper is the legal seam, mirroring
 * `isNativeGraphRuntime` and every other module's own desktop-runtime probe.
 */

import { isDesktopRuntime } from '#/utils/desktopBridge';

export function isDesktopExternalPluginRuntime(): boolean {
    return isDesktopRuntime();
}
