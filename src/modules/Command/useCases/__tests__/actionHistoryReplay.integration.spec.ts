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
    recordActionHistoryEntries,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { chordTrackStore } from '#/modules/MIDI/stores';
import { getChordTrackHandlers } from '#/modules/MIDI/useCases';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { hasActionReplayCapability } from '../../stores/actionReplayCapabilities';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { setActionHistoryMetadataPort } from '../actionHistoryMetadataPort';
import { clearActionHistory } from '../clearActionHistory';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeAppAction } from '../executeAppAction';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { getActionReplayStatus } from '../getActionReplayStatus';
import { resetActionReplayAuthority } from '../resetActionReplayAuthority';
import { revertAction } from '../revertAction';
import { syncActionReplayMetadata } from '../syncActionReplayMetadata';

type SetSnapValueAction = Extract<AppAction, { type: 'setSnapValue' }>;
type TogglePlaybackAction = Extract<AppAction, { type: 'togglePlayback' }>;
type IntegrationDocument = { actionHistory?: unknown };

const no_action_history_metadata_port = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

async function flush_pending_frame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe('Command action-history replay integration', () => {
    const executed_actions: string[] = [];
    let unsubscribe_action_history: (() => void) | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
        executed_actions.length = 0;
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearCrdtActionHistory();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            recordBatch: recordActionHistoryEntries,
            markReverted: markActionHistoryEntryReverted,
            clear: clearCrdtActionHistory,
        });
        unsubscribe_action_history = actionHistoryStore.subscribe((state) => {
            syncActionReplayMetadata(state?.entries ?? []);
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
        unsubscribe_action_history?.();
        unsubscribe_action_history = null;
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

    it('should revoke local authority on hydrated metadata replacement and clear-readd continuity break', async () => {
        const first_entry_id = '00000000-0000-4000-8000-000000000010';
        vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(first_entry_id);
        await executeAppAction({ type: 'setSnapValue', payload: { value: 0 } });
        const original_entry = actionHistoryStore.value?.entries.find((entry) => entry.id === first_entry_id);
        if (!original_entry) {
            throw new Error('Expected original action metadata');
        }
        await flush_pending_frame();

        mutateCrdtDoc<IntegrationDocument>({
            id: 'root',
            changeFn: (document) => {
                document.actionHistory = {
                    entries: [
                        {
                            id: original_entry.id,
                            label: 'Peer replacement',
                            actionKind: original_entry.actionKind,
                            source: original_entry.source,
                            timestamp: original_entry.timestamp,
                            reverted: original_entry.reverted,
                        },
                    ],
                };
            },
        });
        actionHistoryStore.hydrate();

        expect(getActionReplayStatus(first_entry_id)).toEqual({ status: 'unavailable' });

        const second_entry_id = '00000000-0000-4000-8000-000000000011';
        vi.mocked(crypto.randomUUID).mockReturnValueOnce(second_entry_id);
        await executeAppAction({ type: 'setSnapValue', payload: { value: 0 } });
        const second_entry = actionHistoryStore.value?.entries.find((entry) => entry.id === second_entry_id);
        if (!second_entry) {
            throw new Error('Expected second action metadata');
        }

        clearCrdtActionHistory();
        recordActionHistoryEntry(second_entry);

        expect(getActionReplayStatus(second_entry_id)).toEqual({ status: 'unavailable' });
    });

    it('publishes every grouped metadata entry to the real history store in command order', async () => {
        clearHandlerRegistry();
        registerHandlerMap({
            setSnapValue: {
                describe: () => ({ label: 'Set snap value' }),
                execute: () => undefined,
                undoable: true,
            },
            togglePlayback: {
                describe: () => ({ label: 'Toggle playback' }),
                execute: () => undefined,
                undoable: true,
            },
        });
        await expect(
            executeAppActionBatch([{ type: 'setSnapValue', payload: { value: 0.5 } }, { type: 'togglePlayback' }], {
                groupId: 'group-metadata',
                groupLabel: 'Grouped metadata',
                source: 'ai',
            })
        ).resolves.toMatchObject({ status: 'committed' });

        expect(actionHistoryStore.value?.entries).toMatchObject([
            {
                actionKind: 'setSnapValue',
                groupId: 'group-metadata',
                groupLabel: 'Grouped metadata',
                source: 'ai',
            },
            {
                actionKind: 'togglePlayback',
                groupId: 'group-metadata',
                groupLabel: 'Grouped metadata',
                source: 'ai',
            },
        ]);
    });

    it('revokes replay authority for grouped entries evicted before capability registration', async () => {
        unsubscribe_action_history?.();
        unsubscribe_action_history = null;
        const evictedReplayableEntryId = '00000000-0000-4000-8000-000000000020';
        vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(evictedReplayableEntryId);
        const actions: SetSnapValueAction[] = Array.from({ length: 202 }, (_, value) => ({
            type: 'setSnapValue',
            payload: { value },
        }));

        await expect(
            executeAppActionBatch(actions, {
                groupId: 'group-crossing-history-bound',
                groupLabel: 'Cross history bound',
            })
        ).resolves.toMatchObject({ status: 'committed' });

        expect(actionHistoryStore.value?.entries).toHaveLength(200);
        expect(actionHistoryStore.value?.entries.some(({ id }) => id === evictedReplayableEntryId)).toBe(false);
        expect(hasActionReplayCapability(evictedReplayableEntryId)).toBe(false);
        expect(getActionReplayStatus(evictedReplayableEntryId)).toEqual({ status: 'unavailable' });
    });

    it('conflicts rather than overwriting a later chord edit', async () => {
        registerHandlerMap(getChordTrackHandlers());
        chordTrackStore.set({
            enabled: true,
            events: [{ id: 'chord-a', beat: 0, root: 0, quality: 'major', duration: 4 }],
        });
        await executeAppAction({ type: 'moveChordEvent', payload: { eventId: 'chord-a', beat: 8 } });
        const actionAId = actionHistoryStore.value?.entries.at(-1)?.id;
        if (!actionAId) {
            throw new Error('Expected chord action history');
        }
        await executeAppAction({ type: 'moveChordEvent', payload: { eventId: 'chord-a', beat: 12 } });
        const afterActionB = structuredClone(chordTrackStore.value);
        expect(await revertAction(actionAId)).toEqual({ status: 'conflict' });
        expect(chordTrackStore.value).toEqual(afterActionB);
    });

    it('should not mark a same-ID replacement that arrives while inverse execution is pending', async () => {
        let resolve_inverse: (() => void) | undefined;
        const pending_toggle_handler: ActionHandler<TogglePlaybackAction> = {
            undoable: false,
            execute: () =>
                new Promise<void>((resolve) => {
                    resolve_inverse = resolve;
                }),
            describe: () => ({ label: 'Toggle playback' }),
        };
        await executeAppAction({ type: 'setSnapValue', payload: { value: 0 } });
        const entry = actionHistoryStore.value?.entries.at(-1);
        if (!entry) {
            throw new Error('Expected replayable metadata');
        }
        await flush_pending_frame();
        clearHandlerRegistry();
        registerHandlerMap({ togglePlayback: pending_toggle_handler });

        const replay = revertAction(entry.id);
        await vi.waitFor(() => {
            expect(resolve_inverse).toBeDefined();
        });
        mutateCrdtDoc<IntegrationDocument>({
            id: 'root',
            changeFn: (document) => {
                document.actionHistory = {
                    entries: [
                        {
                            id: entry.id,
                            label: 'Peer replacement',
                            actionKind: entry.actionKind,
                            source: entry.source,
                            timestamp: entry.timestamp,
                            reverted: false,
                        },
                    ],
                };
            },
        });
        actionHistoryStore.hydrate();
        resolve_inverse?.();

        await expect(replay).resolves.toEqual({ status: 'executed-unmarked' });
        expect(actionHistoryStore.value?.entries[0]).toEqual(
            expect.objectContaining({ id: entry.id, label: 'Peer replacement', reverted: false })
        );
        expect(getActionReplayStatus(entry.id)).toEqual({ status: 'unavailable' });
    });

    it('should not retry marking after pending reconciliation metadata is replaced', async () => {
        const mark_failure = new Error('mark failed');
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: () => {
                throw mark_failure;
            },
            clear: clearCrdtActionHistory,
        });
        await executeAppAction({ type: 'setSnapValue', payload: { value: 0 } });
        const entry = actionHistoryStore.value?.entries.at(-1);
        if (!entry) {
            throw new Error('Expected replayable metadata');
        }
        await flush_pending_frame();

        await expect(revertAction(entry.id)).rejects.toBe(mark_failure);
        mutateCrdtDoc<IntegrationDocument>({
            id: 'root',
            changeFn: (document) => {
                document.actionHistory = {
                    entries: [
                        {
                            id: entry.id,
                            label: 'Peer replacement',
                            actionKind: entry.actionKind,
                            source: entry.source,
                            timestamp: entry.timestamp,
                            reverted: false,
                        },
                    ],
                };
            },
        });
        actionHistoryStore.hydrate();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearCrdtActionHistory,
        });

        expect(await revertAction(entry.id)).toEqual({ status: 'unavailable' });
        expect(actionHistoryStore.value?.entries[0]).toEqual(
            expect.objectContaining({ id: entry.id, label: 'Peer replacement', reverted: false })
        );
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
