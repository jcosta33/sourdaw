import { closePluginGui as closePluginGuiRepo } from '../../repositories/pluginBridge/closePluginGui';

import { recordPluginGuiState } from './pluginGuiState';
import { serializePluginLifecycle } from './serializePluginLifecycle';

/**
 * Close a plugin's GUI window and record that it is closed.
 *
 * Serialized against this instance's other lifecycle work for the same reason
 * the open is: both address one window label, and overlapping calls would race
 * the store's last write against the window actually on screen.
 *
 * A refusal is recorded rather than thrown, and it leaves the editor open,
 * because that is what it still is: a control that recorded the close anyway
 * would offer to open a window already on screen, which the host then refuses
 * for being open.
 */
export function closePluginGui(instanceId: string): Promise<void> {
    return serializePluginLifecycle(instanceId, async () => {
        try {
            await closePluginGuiRepo(instanceId);
            recordPluginGuiState(instanceId, { isOpen: false });
        } catch (error: unknown) {
            recordPluginGuiState(instanceId, {
                isOpen: true,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
}
