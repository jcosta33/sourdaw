import { closePluginGui as closePluginGuiRepo } from '../../repositories/pluginBridge/closePluginGui';

import { recordPluginGuiState } from './pluginGuiState';

/**
 * Close a plugin's GUI window and record that it is closed.
 *
 * A refusal is recorded rather than thrown, and it leaves the editor open,
 * because that is what it still is: a control that recorded the close anyway
 * would offer to open a window already on screen, which the host then refuses
 * for being open.
 */
export async function closePluginGui(instanceId: string): Promise<void> {
    try {
        await closePluginGuiRepo(instanceId);
        recordPluginGuiState(instanceId, { isOpen: false });
    } catch (error: unknown) {
        recordPluginGuiState(instanceId, {
            isOpen: true,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
