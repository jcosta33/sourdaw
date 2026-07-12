import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { aiActionHistoryStore } from '#/modules/AiRuntime/stores';
import { actionReplayRevisionStore, clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    executeAppAction,
    getActionReplayStatus,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    syncActionReplayMetadata,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory as clearCrdtActionHistory,
    createCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';

import { AiActionHistoryPanel } from '../AiActionHistoryPanel';

const no_action_history_metadata_port = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

describe('AiActionHistoryPanel replay revision integration', () => {
    let unsubscribe_action_history: (() => void) | null = null;

    beforeEach(() => {
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearCrdtActionHistory();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearCrdtActionHistory,
        });
        unsubscribe_action_history = actionHistoryStore.subscribe((state) => {
            syncActionReplayMetadata(state?.entries ?? []);
        });
        clearHandlerRegistry();
        act(() => {
            resetActionReplayAuthority();
        });
        aiActionHistoryStore.set({ groups: [], panelOpen: true });
        registerHandlerMap({
            setSnapValue: {
                undoable: true,
                execute: vi.fn(),
                describe: () => ({ label: 'Set snap', inverseAction: { type: 'togglePlayback' } }),
            },
        });
    });

    afterEach(() => {
        unsubscribe_action_history?.();
        unsubscribe_action_history = null;
        clearHandlerRegistry();
        act(() => {
            resetActionReplayAuthority();
        });
        clearCrdtActionHistory();
        setActionHistoryMetadataPort(no_action_history_metadata_port);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('should remove Revert immediately after authority reset without metadata changing', async () => {
        await executeAppAction({ type: 'setSnapValue', payload: { value: 0 } });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const metadata_before_reset = actionHistoryStore.value;
        render(<AiActionHistoryPanel />);
        expect(screen.getByLabelText('Revert this change')).toBeInTheDocument();
        expect(actionReplayRevisionStore.getSnapshot()).toBeTypeOf('number');

        act(() => {
            resetActionReplayAuthority();
        });

        const entry_id = actionHistoryStore.value?.entries[0]?.id;
        expect(entry_id).toBeTypeOf('string');
        if (!entry_id) {
            throw new Error('Expected action-history metadata to remain available');
        }
        expect(getActionReplayStatus(entry_id)).toEqual({ status: 'unavailable' });
        await waitFor(() => expect(screen.queryByLabelText('Revert this change')).not.toBeInTheDocument());
        expect(actionHistoryStore.value).toEqual(metadata_before_reset);
    });
});
