import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, markerStore } from '#/modules/Arrangement/stores';
import { setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory,
    createCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntries,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    subscribeToPublishedActionHistory,
} from '#/modules/CrdtDocument/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { clearHandlerRegistry } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { setActionHistoryMetadataPort } from '../actionHistoryMetadataPort';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeAppAction } from '../executeAppAction';
import { redo } from '../redo';
import { registerProductionCommandHandlers } from '../registerProductionCommandHandlers';
import { resetActionReplayAuthority } from '../resetActionReplayAuthority';
import { revertAction } from '../revertAction';
import { syncActionReplayMetadata } from '../syncActionReplayMetadata';
import { undo } from '../undo';
import { undoReplayPreparationPort } from '../undoReplayPreparationPort';

// Issue 6692: an out-of-order revert from the action history is a new edit, so a
// later redo must not replay an undone relative forward (reorderSection) over the
// state the revert changed. Real Arrangement handlers, stores and dispatch.

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

const S1 = { id: 's1', startBeat: 0, endBeat: 8, name: 'Intro', color: '#111111' };
const S2 = { id: 's2', startBeat: 8, endBeat: 20, name: 'Verse', color: '#222222' };
const S3 = { id: 's3', startBeat: 20, endBeat: 24, name: 'Chorus', color: '#333333' };

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const sectionOrder = () => markerStore.value?.sections.map((section) => section.id);

describe('revertAction discards the redo future once its inverse lands', () => {
    let unsubscribeFromHistory: () => void = () => undefined;

    beforeEach(() => {
        Container.clear();
        setNotificationEventBus(createEventBus<NotificationEvents>());
        setArrangementEventBus(createEventBus<Record<string, never>>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('revert action redo future integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            recordBatch: recordActionHistoryEntries,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        unsubscribeFromHistory = subscribeToPublishedActionHistory({
            onHistory: syncActionReplayMetadata,
            onRootReplaced: resetActionReplayAuthority,
        });
        setTrackStoreState(structuredClone(defaultTrackState));
        markerStore.set({ markers: [], sections: structuredClone([S1, S2, S3]) });
    });

    afterEach(() => {
        unsubscribeFromHistory();
        unsubscribeFromHistory = () => undefined;
        clearActionHistory();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        setTrackStoreState(structuredClone(defaultTrackState));
        markerStore.set({ markers: [], sections: [] });
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    async function moveFirstSectionRightTwice(): Promise<string> {
        await executeAppAction({ type: 'reorderSection', payload: { sectionId: 's1', direction: 'right' } });
        const firstMove = actionHistoryStore.value?.entries.find((entry) => entry.actionKind === 'reorderSection');
        if (!firstMove) {
            throw new Error('Expected the first section move in the action history');
        }
        await executeAppAction({ type: 'reorderSection', payload: { sectionId: 's1', direction: 'right' } });
        expect(sectionOrder()).toEqual(['s2', 's3', 's1']);
        return firstMove.id;
    }

    it('redo after reverting the first move out of order replays nothing', async () => {
        const firstMoveId = await moveFirstSectionRightTwice();

        await undo({ stepOverConflicts: false });
        expect(sectionOrder()).toEqual(['s2', 's1', 's3']);
        expect(undoStore.value?.future).toHaveLength(1);

        await expect(revertAction(firstMoveId)).resolves.toEqual({ status: 'executed' });
        expect(sectionOrder()).toEqual(['s1', 's2', 's3']);
        expect.soft(undoStore.value?.future).toEqual([]);

        await redo();
        expect(sectionOrder()).toEqual(['s1', 's2', 's3']);
    });

    it('redo with no revert still replays the undone move', async () => {
        await moveFirstSectionRightTwice();

        await undo({ stepOverConflicts: false });
        expect(sectionOrder()).toEqual(['s2', 's1', 's3']);

        await redo();
        expect(sectionOrder()).toEqual(['s2', 's3', 's1']);
        expect(undoStore.value?.future).toEqual([]);
    });

    it('keeps the redo future when the reverted entry is already undone by a later edit', async () => {
        await executeAppAction({ type: 'renameSection', payload: { sectionId: 's1', name: 'Hook' } });
        const rename = actionHistoryStore.value?.entries.find((entry) => entry.actionKind === 'renameSection');
        if (!rename) {
            throw new Error('Expected the section rename in the action history');
        }
        await executeAppAction({ type: 'renameSection', payload: { sectionId: 's1', name: 'Intro' } });
        await executeAppAction({ type: 'reorderSection', payload: { sectionId: 's2', direction: 'right' } });
        await undo({ stepOverConflicts: false });
        expect(sectionOrder()).toEqual(['s1', 's2', 's3']);

        await expect(revertAction(rename.id)).resolves.toEqual({ status: 'executed' });
        expect(undoStore.value?.future).toHaveLength(1);

        await redo();
        expect(sectionOrder()).toEqual(['s1', 's3', 's2']);
    });

    it('a redo started while the revert prepares waits for it and replays nothing', async () => {
        const firstMoveId = await moveFirstSectionRightTwice();
        await undo({ stepOverConflicts: false });
        expect(sectionOrder()).toEqual(['s2', 's1', 's3']);

        let releaseRevert: () => void = () => undefined;
        const revertHeld = new Promise<void>((resolve) => {
            releaseRevert = resolve;
        });
        let revertPreparing: () => void = () => undefined;
        const revertStarted = new Promise<void>((resolve) => {
            revertPreparing = resolve;
        });
        undoReplayPreparationPort.setProvider(async (_entries, actions) => {
            if (actions.length > 0) {
                revertPreparing();
                await revertHeld;
            }
            return () => undefined;
        });

        const revert = revertAction(firstMoveId);
        const racingRedo = redo();
        await Promise.race([revertStarted, racingRedo]);
        releaseRevert();

        await expect(revert).resolves.toEqual({ status: 'executed' });
        await racingRedo;
        expect(sectionOrder()).toEqual(['s1', 's2', 's3']);
        expect(undoStore.value?.future).toEqual([]);
    });
});
