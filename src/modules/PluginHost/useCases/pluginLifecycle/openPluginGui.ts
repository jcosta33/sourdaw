import { openPluginGui as openPluginGuiRepo } from '../../repositories/pluginBridge/openPluginGui';

import { recordPluginGuiState } from './pluginGuiState';
import { serializePluginLifecycle } from './serializePluginLifecycle';
import { watchPluginGuiClosed } from './watchPluginGuiClosed';

/**
 * Open a plugin's GUI window and record what happened to it.
 *
 * The open is what starts listening for the OS closing that window again: until
 * an editor exists that subscription has nothing to report, and the watch is
 * idempotent, so every later open reuses the first one.
 *
 * Serialized against this instance's other lifecycle work, like every other
 * per-instance operation. The rack's control has no pending state, so a
 * double-click issues two calls against one window label; run concurrently they
 * settle in either order and the later refusal outlives the earlier success,
 * leaving the store claiming closed while the window is on screen.
 *
 * A refusal is recorded rather than thrown, and the host's own reason is kept
 * with it. The caller is a control in the device rack with nowhere to catch, and
 * a control that swallowed the refusal would read as one that does nothing.
 */
export function openPluginGui(instanceId: string): Promise<void> {
    watchPluginGuiClosed();

    return serializePluginLifecycle(instanceId, async () => {
        try {
            const info = await openPluginGuiRepo(instanceId);
            // No window and no refusal to quote — a runtime with no native host
            // answers this way, and "still closed" is the whole of what is known.
            recordPluginGuiState(instanceId, { isOpen: info.is_open });
        } catch (error: unknown) {
            recordPluginGuiState(instanceId, {
                isOpen: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
}
