import { actionHistoryStore } from '#/modules/CrdtDocument/stores';

import { claimActionReplayCapability, restoreActionReplayCapability } from '../stores/actionReplayCapabilities';

import { actionHistoryMetadataPort } from './actionHistoryMetadataPort';
import { executeAppAction } from './executeAppAction';

export async function revertAction(entryId: string): Promise<boolean> {
    const entry = actionHistoryStore.value?.entries.find((history_entry) => history_entry.id === entryId);
    if (!entry || entry.reverted) {
        return false;
    }

    const inverse_action = claimActionReplayCapability(entryId);
    if (!inverse_action) {
        return false;
    }

    try {
        await executeAppAction(inverse_action, {
            source: entry.source,
            groupLabel: `Reverted: ${entry.label}`,
        });
    } catch (error) {
        restoreActionReplayCapability({ entryId, inverseAction: inverse_action });
        throw error;
    }

    actionHistoryMetadataPort.markReverted(entryId);
    return true;
}
