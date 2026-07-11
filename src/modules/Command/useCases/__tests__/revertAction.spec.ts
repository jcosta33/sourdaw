import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppActionCommittedError, AppActionNotDispatchedError } from '../../errors/AppActionExecutionError';
import {
    clearActionReplayCapabilities,
    registerActionReplayCapability as registerStoredActionReplayCapability,
} from '../../stores/actionReplayCapabilities';
import { getActionReplayStatus } from '../getActionReplayStatus';
import { revertAction } from '../revertAction';

type TestHistoryEntry = {
    id: string;
    label: string;
    actionKind: string;
    source: 'manual' | 'prompt' | 'voice' | 'ai';
    timestamp: number;
    reverted: boolean;
};

type TestHistoryState = {
    entries: TestHistoryEntry[];
};

const mocks = vi.hoisted(() => {
    const action_history_store: { value: TestHistoryState } = { value: { entries: [] } };

    return {
        action_history_store,
        execute_app_action: vi.fn<typeof import('../executeAppAction').executeAppAction>(),
        mark_reverted: vi.fn<(entry_id: string) => void>(),
    };
});

vi.mock('#/modules/CrdtDocument/stores', () => ({
    actionHistoryStore: mocks.action_history_store,
}));

vi.mock('../executeAppAction', () => ({
    executeAppAction: mocks.execute_app_action,
}));

vi.mock('../actionHistoryMetadataPort', () => ({
    actionHistoryMetadataPort: {
        record: vi.fn(),
        markReverted: mocks.mark_reverted,
        clear: vi.fn(),
    },
}));

function create_entry(overrides: Partial<TestHistoryEntry> = {}): TestHistoryEntry {
    return {
        id: 'entry-1',
        label: 'Set tempo',
        actionKind: 'setTempo',
        source: 'manual',
        timestamp: 10,
        reverted: false,
        ...overrides,
    };
}

type TestInverseAction = Parameters<typeof registerStoredActionReplayCapability>[0]['inverseAction'];

function registerActionReplayCapability(input: { entryId: string; inverseAction: TestInverseAction }): void {
    registerStoredActionReplayCapability({
        ...input,
        metadata: create_entry({ id: input.entryId }),
    });
}

describe('revertAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearActionReplayCapabilities();
        mocks.action_history_store.value = { entries: [] };
        mocks.execute_app_action.mockResolvedValue(undefined);
    });

    it('should reject hydrated, peer-supplied, and unknown IDs without a session capability', async () => {
        mocks.action_history_store.value = { entries: [create_entry()] };

        expect(getActionReplayStatus('entry-1')).toEqual({ status: 'unavailable' });
        expect(await revertAction('entry-1')).toEqual({ status: 'unavailable' });
        expect(await revertAction('unknown-entry')).toEqual({ status: 'unavailable' });
        expect(mocks.execute_app_action).not.toHaveBeenCalled();
    });

    it('should replay a claimed inverse once and mark metadata only after execution', async () => {
        const entry = create_entry();
        const inverse_action = { type: 'setTempo', payload: { bpm: 120 } } as const;
        const order: string[] = [];
        mocks.action_history_store.value = { entries: [entry] };
        mocks.execute_app_action.mockImplementation(async () => {
            order.push('execute');
        });
        mocks.mark_reverted.mockImplementation(() => {
            order.push('mark');
        });
        registerActionReplayCapability({ entryId: entry.id, inverseAction: inverse_action });

        expect(getActionReplayStatus(entry.id)).toEqual({ status: 'ready' });
        expect(await revertAction(entry.id)).toEqual({ status: 'executed' });
        expect(order).toEqual(['execute', 'mark']);
        expect(mocks.execute_app_action).toHaveBeenCalledWith(inverse_action, {
            source: entry.source,
            groupLabel: `Reverted: ${entry.label}`,
        });
        expect(mocks.mark_reverted).toHaveBeenCalledWith(entry.id);
        expect(getActionReplayStatus(entry.id)).toEqual({ status: 'unavailable' });
        expect(await revertAction(entry.id)).toEqual({ status: 'unavailable' });
        expect(mocks.execute_app_action).toHaveBeenCalledTimes(1);
    });

    it('should restore the claimed capability and leave metadata active when execution fails', async () => {
        const entry = create_entry();
        const inverse_action = { type: 'setTempo', payload: { bpm: 120 } } as const;
        const failure = new Error('replay failed');
        mocks.action_history_store.value = { entries: [entry] };
        mocks.execute_app_action.mockRejectedValueOnce(failure);
        registerActionReplayCapability({ entryId: entry.id, inverseAction: inverse_action });

        await expect(revertAction(entry.id)).rejects.toBe(failure);

        expect(getActionReplayStatus(entry.id)).toEqual({ status: 'ready' });
        expect(mocks.mark_reverted).not.toHaveBeenCalled();
    });

    it('should restore a claim without marking when replay was not dispatched', async () => {
        const entry = create_entry();
        const failure = new AppActionNotDispatchedError('togglePlayback');
        mocks.action_history_store.value = { entries: [entry] };
        mocks.execute_app_action.mockRejectedValueOnce(failure);
        registerActionReplayCapability({ entryId: entry.id, inverseAction: { type: 'togglePlayback' } });

        await expect(revertAction(entry.id)).rejects.toBe(failure);

        expect(getActionReplayStatus(entry.id)).toEqual({ status: 'ready' });
        expect(mocks.mark_reverted).not.toHaveBeenCalled();
    });

    it('should mark the original reverted without restoring after committed metadata failure', async () => {
        const entry = create_entry();
        const failure = new AppActionCommittedError('togglePlayback', new Error('metadata failed'));
        mocks.action_history_store.value = { entries: [entry] };
        mocks.execute_app_action.mockRejectedValueOnce(failure);
        registerActionReplayCapability({ entryId: entry.id, inverseAction: { type: 'togglePlayback' } });

        await expect(revertAction(entry.id)).rejects.toBe(failure);

        expect(mocks.mark_reverted).toHaveBeenCalledWith(entry.id);
        expect(getActionReplayStatus(entry.id)).toEqual({ status: 'unavailable' });
        expect(await revertAction(entry.id)).toEqual({ status: 'unavailable' });
        expect(mocks.execute_app_action).toHaveBeenCalledTimes(1);
    });

    it('should not restore a pending replay capability after history is cleared', async () => {
        const entry = create_entry();
        const failure = new Error('replay failed after clear');
        let reject_execution: ((error: Error) => void) | undefined;
        mocks.action_history_store.value = { entries: [entry] };
        mocks.execute_app_action.mockImplementation(
            () =>
                new Promise<void>((_resolve, reject) => {
                    reject_execution = (error) => reject(error);
                })
        );
        registerActionReplayCapability({ entryId: entry.id, inverseAction: { type: 'togglePlayback' } });

        const replay = revertAction(entry.id);
        clearActionReplayCapabilities();
        if (reject_execution === undefined) {
            throw new Error('Expected replay execution to be pending');
        }
        reject_execution(failure);

        await expect(replay).rejects.toBe(failure);
        expect(getActionReplayStatus(entry.id)).toEqual({ status: 'unavailable' });
        expect(mocks.mark_reverted).not.toHaveBeenCalled();
    });

    it('should retry only metadata marking after the inverse committed and marking failed', async () => {
        const entry = create_entry();
        const mark_failure = new Error('mark failed');
        mocks.action_history_store.value = { entries: [entry] };
        mocks.mark_reverted.mockImplementationOnce(() => {
            throw mark_failure;
        });
        registerActionReplayCapability({ entryId: entry.id, inverseAction: { type: 'togglePlayback' } });

        await expect(revertAction(entry.id)).rejects.toBe(mark_failure);

        expect(getActionReplayStatus(entry.id)).toEqual({ status: 'reconcile-mark' });
        expect(await revertAction(entry.id)).toEqual({ status: 'reconciled' });
        expect(mocks.execute_app_action).toHaveBeenCalledTimes(1);
        expect(mocks.mark_reverted).toHaveBeenCalledTimes(2);
        expect(getActionReplayStatus(entry.id)).toEqual({ status: 'unavailable' });
    });

    it('should claim before awaiting so overlapping replays cannot execute twice', async () => {
        const entry = create_entry();
        const inverse_action = { type: 'togglePlayback' } as const;
        mocks.action_history_store.value = { entries: [entry] };
        registerActionReplayCapability({ entryId: entry.id, inverseAction: inverse_action });

        const first_replay = revertAction(entry.id);
        const second_result = await revertAction(entry.id);

        expect(second_result).toEqual({ status: 'unavailable' });
        await first_replay;
        expect(mocks.execute_app_action).toHaveBeenCalledTimes(1);
    });
});
