import { actionHistoryStore } from '#/modules/CrdtDocument/stores';

import { getActionReplayMarkReconciliation, hasCurrentActionReplayCapability } from '../stores/actionReplayCapabilities';

type GetActionReplayStatusOutput = { status: 'ready' } | { status: 'reconcile-mark' } | { status: 'unavailable' };

export function getActionReplayStatus(entryId: string): GetActionReplayStatusOutput {
    const entry = actionHistoryStore.value?.entries.find((history_entry) => history_entry.id === entryId);
    if (!entry || entry.reverted) {
        return { status: 'unavailable' };
    }

    if (getActionReplayMarkReconciliation({ entryId, metadata: entry })) {
        return { status: 'reconcile-mark' };
    }

    if (hasCurrentActionReplayCapability({ entryId, metadata: entry })) {
        return { status: 'ready' };
    }

    return { status: 'unavailable' };
}
