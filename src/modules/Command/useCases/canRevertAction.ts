import { actionHistoryStore } from '#/modules/CrdtDocument/stores';

import { hasActionReplayCapability } from '../stores/actionReplayCapabilities';

export function canRevertAction(entryId: string): boolean {
    const entry = actionHistoryStore.value?.entries.find((history_entry) => history_entry.id === entryId);
    if (!entry || entry.reverted) {
        return false;
    }

    return hasActionReplayCapability(entryId);
}
