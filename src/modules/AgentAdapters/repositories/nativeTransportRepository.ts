/**
 * The module's only desktop IPC seam.
 *
 * A hardware or remote transport can only be carried by the desktop shell, so
 * this answers whether that shell is there at all. It probes presence and
 * nothing else — it opens no channel, registers no listener and sends no
 * command — and it lives here so the rest of the module has no reason to reach
 * for the bridge: the boundary spec pins that no file outside `repositories/`
 * imports it.
 */

import { isDesktopRuntime } from '#/utils/desktopBridge';

export function readNativeTransportSupport(): { available: boolean } {
    return { available: isDesktopRuntime() };
}
