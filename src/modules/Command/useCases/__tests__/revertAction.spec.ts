import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    AppActionCommittedError,
    AppActionConflictError,
    AppActionNotDispatchedError,
} from '../../errors/AppActionExecutionError';
import { type UndoEntry } from '../../models/UndoEntry';
import {
    clearActionReplayCapabilities,
    registerActionReplayCapability as registerStoredActionReplayCapability,
} from '../../stores/actionReplayCapabilities';
import { undoStore } from '../../stores/undoStore';
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
        mark_reverted:
            vi.fn<(input: { entryId: string; expectedFingerprint: string }) => { status: 'marked' | 'unavailable' }>(),
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

const UNDONE_ENTRY: UndoEntry = {
    kind: 'action',
    id: 'undone-entry',
    label: 'Set tempo',
    timestamp: 20,
    source: 'manual',
    action: { type: 'setTempo', payload: { bpm: 140 } },
    inverseAction: { type: 'setTempo', payload: { bpm: 120 } },
};

describe('revertAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearActionReplayCapabilities();
        undoStore.set({ past: [], future: [UNDONE_ENTRY] });
        mocks.action_history_store.value = { entries: [] };
        mocks.execute_app_action.mockImplementation((_action, options) => {
            options?.onCommitted?.();
            return Promise.resolve();
        });
        mocks.mark_reverted.mockReturnValue({ status: 'marked' });
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
        mocks.execute_app_action.mockImplementation((_action, options) => {
            order.push('execute');
            options?.onCommitted?.();
            return Promise.resolve();
        });
        mocks.mark_reverted.mockImplementation(() => {
            order.push('mark');
            return { status: 'marked' };
        });
        registerActionReplayCapability({ entryId: entry.id, inverseAction: inverse_action });

        expect(getActionReplayStatus(entry.id)).toEqual({ status: 'ready' });
        expect(await revertAction(entry.id)).toEqual({ status: 'executed' });
        expect(order).toEqual(['execute', 'mark']);
        expect(mocks.execute_app_action).toHaveBeenCalledWith(inverse_action, {
            undoEntryId: entry.id,
            source: entry.source,
            groupLabel: `Reverted: ${entry.label}`,
            onCommitted: expect.any(Function),
        });
        expect(mocks.mark_reverted).toHaveBeenCalledWith({
            entryId: entry.id,
            expectedFingerprint: '["entry-1","Set tempo","setTempo","manual",10,null,null]',
        });
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

        expect(mocks.mark_reverted).toHaveBeenCalledWith({
            entryId: entry.id,
            expectedFingerprint: '["entry-1","Set tempo","setTempo","manual",10,null,null]',
        });
        expect(getActionReplayStatus(entry.id)).toEqual({ status: 'unavailable' });
        expect(await revertAction(entry.id)).toEqual({ status: 'unavailable' });
        expect(mocks.execute_app_action).toHaveBeenCalledTimes(1);
    });

    it('should report executed-unmarked when committed execution finds replacement metadata', async () => {
        const entry = create_entry();
        const committed_failure = new AppActionCommittedError('togglePlayback', new Error('inverse history failed'));
        mocks.action_history_store.value = { entries: [entry] };
        mocks.execute_app_action.mockRejectedValueOnce(committed_failure);
        mocks.mark_reverted.mockReturnValue({ status: 'unavailable' });
        registerActionReplayCapability({ entryId: entry.id, inverseAction: { type: 'togglePlayback' } });

        await expect(revertAction(entry.id)).resolves.toEqual({ status: 'executed-unmarked' });

        expect(getActionReplayStatus(entry.id)).toEqual({ status: 'unavailable' });
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
        await vi.waitFor(() => expect(mocks.execute_app_action).toHaveBeenCalledTimes(1));
        clearActionReplayCapabilities();
        if (reject_execution === undefined) {
            throw new Error('Expected replay execution to be pending');
        }
        reject_execution(failure);

        await expect(replay).rejects.toBe(failure);
        expect(getActionReplayStatus(entry.id)).toEqual({ status: 'unavailable' });
        expect(mocks.mark_reverted).not.toHaveBeenCalled();
    });

    it('should not mark replacement metadata after replay authority is revoked in flight', async () => {
        const entry = create_entry();
        let resolve_execution: (() => void) | undefined;
        mocks.action_history_store.value = { entries: [entry] };
        mocks.execute_app_action.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    resolve_execution = resolve;
                })
        );
        registerActionReplayCapability({ entryId: entry.id, inverseAction: { type: 'togglePlayback' } });

        const replay = revertAction(entry.id);
        await vi.waitFor(() => expect(mocks.execute_app_action).toHaveBeenCalledTimes(1));
        clearActionReplayCapabilities();
        if (resolve_execution === undefined) {
            throw new Error('Expected replay execution to be pending');
        }
        resolve_execution();

        await expect(replay).resolves.toEqual({ status: 'executed-unmarked' });
        expect(mocks.mark_reverted).not.toHaveBeenCalled();
        expect(getActionReplayStatus(entry.id)).toEqual({ status: 'unavailable' });
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

    it('should make mark-only reconciliation unavailable when metadata provenance changes', async () => {
        const entry = create_entry();
        const mark_failure = new Error('mark failed');
        mocks.action_history_store.value = { entries: [entry] };
        mocks.mark_reverted.mockImplementationOnce(() => {
            throw mark_failure;
        });
        registerActionReplayCapability({ entryId: entry.id, inverseAction: { type: 'togglePlayback' } });

        await expect(revertAction(entry.id)).rejects.toBe(mark_failure);
        mocks.action_history_store.value = { entries: [{ ...entry, label: 'Peer replacement' }] };
        mocks.mark_reverted.mockReturnValue({ status: 'unavailable' });

        expect(await revertAction(entry.id)).toEqual({ status: 'unavailable' });
        expect(mocks.execute_app_action).toHaveBeenCalledTimes(1);
        expect(mocks.mark_reverted).toHaveBeenCalledTimes(1);
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

    describe('redo future', () => {
        function register_entry(): TestHistoryEntry {
            const entry = create_entry();
            mocks.action_history_store.value = { entries: [entry] };
            registerActionReplayCapability({ entryId: entry.id, inverseAction: { type: 'togglePlayback' } });
            return entry;
        }

        it('should discard the redo future once the inverse lands', async () => {
            const entry = register_entry();

            expect(await revertAction(entry.id)).toEqual({ status: 'executed' });

            expect(undoStore.value?.future).toEqual([]);
        });

        it('should discard the redo future when the inverse landed but metadata was replaced', async () => {
            const entry = register_entry();
            mocks.mark_reverted.mockReturnValue({ status: 'unavailable' });

            expect(await revertAction(entry.id)).toEqual({ status: 'executed-unmarked' });

            expect(undoStore.value?.future).toEqual([]);
        });

        it('should discard the redo future when the inverse committed with an error', async () => {
            const entry = register_entry();
            const failure = new AppActionCommittedError('togglePlayback', new Error('metadata failed'));
            mocks.execute_app_action.mockRejectedValueOnce(failure);

            await expect(revertAction(entry.id)).rejects.toBe(failure);

            expect(undoStore.value?.future).toEqual([]);
        });

        it('should discard the redo future when the inverse committed with an error and metadata was replaced', async () => {
            const entry = register_entry();
            mocks.execute_app_action.mockRejectedValueOnce(
                new AppActionCommittedError('togglePlayback', new Error('inverse history failed'))
            );
            mocks.mark_reverted.mockReturnValue({ status: 'unavailable' });

            expect(await revertAction(entry.id)).toEqual({ status: 'executed-unmarked' });

            expect(undoStore.value?.future).toEqual([]);
        });

        it('should keep the redo future when the inverse returns without writing', async () => {
            const entry = register_entry();
            mocks.execute_app_action.mockResolvedValueOnce(undefined);

            expect(await revertAction(entry.id)).toEqual({ status: 'executed' });

            expect(undoStore.value?.future).toEqual([UNDONE_ENTRY]);
        });

        it('should keep the redo future when the inverse conflicts', async () => {
            const entry = register_entry();
            mocks.execute_app_action.mockRejectedValueOnce(new AppActionConflictError('togglePlayback', 'changed'));

            expect(await revertAction(entry.id)).toEqual({ status: 'conflict' });

            expect(undoStore.value?.future).toEqual([UNDONE_ENTRY]);
        });

        it('should keep the redo future when the inverse fails before writing', async () => {
            const entry = register_entry();
            const failure = new AppActionNotDispatchedError('togglePlayback');
            mocks.execute_app_action.mockRejectedValueOnce(failure);

            await expect(revertAction(entry.id)).rejects.toBe(failure);

            expect(undoStore.value?.future).toEqual([UNDONE_ENTRY]);
        });

        it('should keep the redo future when no capability exists', async () => {
            mocks.action_history_store.value = { entries: [create_entry()] };

            expect(await revertAction('entry-1')).toEqual({ status: 'unavailable' });

            expect(undoStore.value?.future).toEqual([UNDONE_ENTRY]);
        });

        it('should keep the redo future made after the inverse when only metadata marking is retried', async () => {
            const entry = register_entry();
            mocks.mark_reverted.mockImplementationOnce(() => {
                throw new Error('mark failed');
            });
            await expect(revertAction(entry.id)).rejects.toThrow('mark failed');
            undoStore.set({ past: [], future: [UNDONE_ENTRY] });

            expect(await revertAction(entry.id)).toEqual({ status: 'reconciled' });

            expect(undoStore.value?.future).toEqual([UNDONE_ENTRY]);
        });
    });
});
