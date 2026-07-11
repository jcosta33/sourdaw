import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory as clearCrdtActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    mutateCrdtDoc,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { setActionHistoryMetadataPort } from '../actionHistoryMetadataPort';
import { clearActionHistory } from '../clearActionHistory';
import { clearUndoHistory } from '../clearUndoHistory';
import { type ActionHandler, type AppAction } from '../commandQueries';
import { executeAppAction } from '../executeAppAction';
import { getActionReplayStatus } from '../getActionReplayStatus';
import { resetActionReplayAuthority } from '../resetActionReplayAuthority';
import { revertAction } from '../revertAction';

type SetSnapValueAction = Extract<AppAction, { type: 'setSnapValue' }>;
type TogglePlaybackAction = Extract<AppAction, { type: 'togglePlayback' }>;
type IntegrationDocument = { actionHistory?: unknown };

const no_action_history_metadata_port = {
    record: () => [],
    markReverted: () => undefined,
    clear: () => undefined,
};

async function flush_pending_frame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe('Command action-history replay integration', () => {
    const executed_actions: string[] = [];

    beforeEach(() => {
        vi.clearAllMocks();
        executed_actions.length = 0;
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearCrdtActionHistory();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearCrdtActionHistory,
        });
        clearHandlerRegistry();
        resetActionReplayAuthority();
        clearUndoHistory();

        const set_snap_handler: ActionHandler<SetSnapValueAction> = {
            undoable: true,
            execute: (action) => {
                executed_actions.push(`setSnapValue:${String(action.payload.value)}`);
            },
            describe: (action) =>
                action.payload.value === 0
                    ? { label: 'Set snap', inverseAction: { type: 'togglePlayback' } }
                    : { label: 'Set snap' },
        };
        const toggle_handler: ActionHandler<TogglePlaybackAction> = {
            undoable: false,
            execute: () => {
                executed_actions.push('togglePlayback');
            },
            describe: () => ({ label: 'Toggle playback' }),
        };
        registerHandlerMap({ setSnapValue: set_snap_handler, togglePlayback: toggle_handler });
    });

    afterEach(async () => {
        clearHandlerRegistry();
        resetActionReplayAuthority();
        clearUndoHistory();
        clearCrdtActionHistory();
        await flush_pending_frame();
        setActionHistoryMetadataPort(no_action_history_metadata_port);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('should wire record, eviction revoke, revert mark, authority reset, and metadata clear', async () => {
        const initial_entry_id = '00000000-0000-4000-8000-000000000001';
        const random_uuid_spy = vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(initial_entry_id);

        await executeAppAction({ type: 'setSnapValue', payload: { value: 0 } });

        expect(actionHistoryStore.value?.entries[0]?.id).toBe(initial_entry_id);
        expect(getActionReplayStatus(initial_entry_id)).toEqual({ status: 'ready' });

        for (let index = 1; index <= 200; index += 1) {
            await executeAppAction({ type: 'setSnapValue', payload: { value: index } });
        }

        expect(actionHistoryStore.value?.entries).toHaveLength(200);
        expect(getActionReplayStatus(initial_entry_id)).toEqual({ status: 'unavailable' });

        await executeAppAction({ type: 'setSnapValue', payload: { value: 0 } });
        const revert_entry_id = actionHistoryStore.value?.entries.at(-1)?.id;
        if (!revert_entry_id) {
            throw new Error('Expected replayable action metadata');
        }

        expect(await revertAction(revert_entry_id)).toEqual({ status: 'executed' });
        expect(actionHistoryStore.value?.entries.find((entry) => entry.id === revert_entry_id)?.reverted).toBe(true);
        expect(executed_actions).toContain('togglePlayback');

        await executeAppAction({ type: 'setSnapValue', payload: { value: 0 } });
        const reset_entry_id = actionHistoryStore.value?.entries.at(-1)?.id;
        if (!reset_entry_id) {
            throw new Error('Expected reset action metadata');
        }
        resetActionReplayAuthority();

        expect(getActionReplayStatus(reset_entry_id)).toEqual({ status: 'unavailable' });
        expect(actionHistoryStore.value?.entries.some((entry) => entry.id === reset_entry_id)).toBe(true);

        random_uuid_spy.mockRestore();
        await executeAppAction({ type: 'setSnapValue', payload: { value: 0 } });
        mutateCrdtDoc<IntegrationDocument>({
            id: 'root',
            changeFn: (document) => {
                document.actionHistory = {
                    entries: [
                        {
                            action: { type: 'setTempo', payload: { bpm: 90 } },
                            inverseAction: { type: 'setTempo', payload: { bpm: 120 } },
                        },
                    ],
                };
            },
        });
        clearActionHistory();

        expect(actionHistoryStore.value).toEqual({ entries: [] });
        const active_document = getCrdtDoc<IntegrationDocument>('root');
        expect(active_document?.actionHistory).toEqual({ entries: [] });
        expect(JSON.stringify(active_document)).not.toContain('inverseAction');
        expect(JSON.stringify(active_document)).not.toContain('"action"');
    });
});
