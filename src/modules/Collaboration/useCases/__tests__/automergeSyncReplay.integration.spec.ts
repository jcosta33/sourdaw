import { change, generateSyncMessage, init, initSyncState } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    getActionReplayStatus,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory as clearCrdtActionHistory,
    createCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { bytesToBase64 } from '#/utils/base64';

import { AutomergeSync } from '../automergeSync';

const no_action_history_metadata_port = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function create_remote_sync_message(): string {
    const remote_document = change(init<{ remoteValue?: string }>(), (document) => {
        document.remoteValue = 'peer update';
    });
    const [, message] = generateSyncMessage(remote_document, initSyncState());
    if (!message) {
        throw new Error('Expected remote sync message');
    }
    return bytesToBase64(message);
}

async function flush_pending_frame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe('AutomergeSync replay authority integration', () => {
    let unsubscribe_projection: (() => void) | null = null;

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
        clearHandlerRegistry();
        resetActionReplayAuthority();
        clearUndoHistory();
        registerHandlerMap({
            setSnapValue: {
                undoable: true,
                execute: () => undefined,
                describe: () => ({ label: 'Set snap', inverseAction: { type: 'togglePlayback' } }),
            },
            togglePlayback: {
                undoable: false,
                execute: () => undefined,
                describe: () => ({ label: 'Toggle playback' }),
            },
        });
    });

    afterEach(async () => {
        unsubscribe_projection?.();
        unsubscribe_projection = null;
        clearHandlerRegistry();
        resetActionReplayAuthority();
        clearUndoHistory();
        clearCrdtActionHistory();
        await flush_pending_frame();
        setActionHistoryMetadataPort(no_action_history_metadata_port);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('should revoke a local capability before applying an accepted peer sync', async () => {
        await executeAppAction({ type: 'setSnapValue', payload: { value: 0 } });
        const entry_id = actionHistoryStore.value?.entries.at(-1)?.id;
        if (!entry_id) {
            throw new Error('Expected local replay metadata');
        }
        expect(getActionReplayStatus(entry_id)).toEqual({ status: 'ready' });
        const hydrate_action_history = vi.spyOn(actionHistoryStore, 'hydrate');
        unsubscribe_projection = setupProjectionBridge();

        const sync = new AutomergeSync({
            getConnectedPeerIds: () => [],
            sendCrdtSync: () => undefined,
        });
        sync.receiveSync({
            peerId: 'peer-1',
            docId: 'root',
            syncMessageBase64: create_remote_sync_message(),
        });

        expect(getActionReplayStatus(entry_id)).toEqual({ status: 'unavailable' });
        expect(hydrate_action_history).toHaveBeenCalled();
    });
});
