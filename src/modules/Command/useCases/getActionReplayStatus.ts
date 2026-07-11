import { actionHistoryStore } from '#/modules/CrdtDocument/stores';

import { hasActionReplayCapability, hasActionReplayMarkReconciliation } from '../stores/actionReplayCapabilities';

type GetActionReplayStatusOutput = { status: 'ready' } | { status: 'reconcile-mark' } | { status: 'unavailable' };

export function getActionReplayStatus(entryId: string): GetActionReplayStatusOutput {
    const entry = actionHistoryStore.value?.entries.find((history_entry) => history_entry.id === entryId);
    if (!entry || entry.reverted) {
        return { status: 'unavailable' };
    }

    if (hasActionReplayMarkReconciliation(entryId)) {
        return { status: 'reconcile-mark' };
    }

    if (hasActionReplayCapability(entryId)) {
        return { status: 'ready' };
    }

    return { status: 'unavailable' };
}
