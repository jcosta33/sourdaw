import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    actionHistoryStore: { value: null as { entries: Array<{ id: string; reverted: boolean }> } | null },
    getActionReplayMarkReconciliation: vi.fn(),
    hasCurrentActionReplayCapability: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/stores', () => ({
    actionHistoryStore: mocks.actionHistoryStore,
}));

vi.mock('../../stores/actionReplayCapabilities', () => ({
    getActionReplayMarkReconciliation: mocks.getActionReplayMarkReconciliation,
    hasCurrentActionReplayCapability: mocks.hasCurrentActionReplayCapability,
}));

import { getActionReplayStatus } from '../getActionReplayStatus';

describe('getActionReplayStatus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.actionHistoryStore.value = null;
        mocks.getActionReplayMarkReconciliation.mockReturnValue(false);
        mocks.hasCurrentActionReplayCapability.mockReturnValue(false);
    });

    it('returns unavailable when the entry does not exist', () => {
        mocks.actionHistoryStore.value = { entries: [{ id: 'other', reverted: false }] };

        const result = getActionReplayStatus('missing');

        expect(result).toEqual({ status: 'unavailable' });
    });

    it('returns unavailable when the store is null', () => {
        mocks.actionHistoryStore.value = null;

        const result = getActionReplayStatus('any');

        expect(result).toEqual({ status: 'unavailable' });
    });

    it('returns unavailable when the entry is reverted', () => {
        mocks.actionHistoryStore.value = { entries: [{ id: 'e1', reverted: true }] };

        const result = getActionReplayStatus('e1');

        expect(result).toEqual({ status: 'unavailable' });
    });

    it('returns reconcile-mark when mark reconciliation is needed', () => {
        mocks.actionHistoryStore.value = { entries: [{ id: 'e1', reverted: false }] };
        mocks.getActionReplayMarkReconciliation.mockReturnValue(true);

        const result = getActionReplayStatus('e1');

        expect(result).toEqual({ status: 'reconcile-mark' });
        expect(mocks.getActionReplayMarkReconciliation).toHaveBeenCalledWith({
            entryId: 'e1',
            metadata: { id: 'e1', reverted: false },
        });
    });

    it('returns ready when the action has current replay capability', () => {
        mocks.actionHistoryStore.value = { entries: [{ id: 'e1', reverted: false }] };
        mocks.hasCurrentActionReplayCapability.mockReturnValue(true);

        const result = getActionReplayStatus('e1');

        expect(result).toEqual({ status: 'ready' });
        expect(mocks.hasCurrentActionReplayCapability).toHaveBeenCalledWith({
            entryId: 'e1',
            metadata: { id: 'e1', reverted: false },
        });
    });

    it('reconcile-mark takes precedence over ready', () => {
        mocks.actionHistoryStore.value = { entries: [{ id: 'e1', reverted: false }] };
        mocks.getActionReplayMarkReconciliation.mockReturnValue(true);
        mocks.hasCurrentActionReplayCapability.mockReturnValue(true);

        const result = getActionReplayStatus('e1');

        expect(result).toEqual({ status: 'reconcile-mark' });
    });

    it('returns unavailable when neither reconciliation nor capability match', () => {
        mocks.actionHistoryStore.value = { entries: [{ id: 'e1', reverted: false }] };

        const result = getActionReplayStatus('e1');

        expect(result).toEqual({ status: 'unavailable' });
    });
});
