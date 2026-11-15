import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, markerStore } from '#/modules/Arrangement/stores';
import { setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

// Undoing removeMarker re-adds the marker through `addMarker`. Marker array order is
// project truth (MarkerLane renders and hit-tests in array order), so undo must put the
// marker back between its original neighbours, also after a collaborator edited the list.
// Real handlers, stores, dispatch.

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const M1 = { id: 'mk-1', beat: 0, name: 'M1', color: '#aa0000' };
const M2 = { id: 'mk-2', beat: 8, name: 'M2', color: '#00aa00' };
const M3 = { id: 'mk-3', beat: 16, name: 'M3', color: '#0000aa' };
const M4 = { id: 'mk-4', beat: 24, name: 'M4', color: '#aaaa00' };

type MarkerRow = typeof M1;

async function addMarkers(rows: readonly MarkerRow[]): Promise<void> {
    for (const row of rows) {
        await executeAppAction({
            type: 'addMarker',
            payload: { beat: row.beat, name: row.name, markerId: row.id, color: row.color },
        });
    }
}

describe('removeMarker undo restores marker order', () => {
    let notifications: NotifyPayload[] = [];
    let unsubscribeFromNotifications: () => void = () => undefined;

    beforeEach(() => {
        Container.clear();
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        setArrangementEventBus(createEventBus<Record<string, never>>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('remove marker undo order integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        markerStore.set({ markers: [], sections: [] });
        setTrackStoreState(structuredClone(defaultTrackState));
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setTrackStoreState(structuredClone(defaultTrackState));
        markerStore.set({ markers: [], sections: [] });
        unsubscribeFromNotifications();
        unsubscribeFromNotifications = () => undefined;
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    const markerIds = () => markerStore.value?.markers.map((marker) => marker.id);
    const setPeerMarkers = (markers: readonly MarkerRow[]) => {
        const current = markerStore.value;
        if (!current) {
            throw new Error('expected marker store to be initialized');
        }
        markerStore.set({ ...current, markers: [...markers] });
    };

    it('restores the first of three markers to its original position', async () => {
        await addMarkers([M1, M2, M3]);
        const before = markerStore.value?.markers;
        await executeAppAction({ type: 'removeMarker', payload: { markerId: M1.id } });
        expect(markerIds()).toEqual([M2.id, M3.id]);

        await undo();

        expect(markerIds()).toEqual([M1.id, M2.id, M3.id]);
        expect(markerStore.value?.markers).toEqual(before);
    });

    it('restores the middle marker to its original position and redoes cleanly', async () => {
        await addMarkers([M1, M2, M3]);
        await executeAppAction({ type: 'removeMarker', payload: { markerId: M2.id } });

        await undo();
        expect(markerIds()).toEqual([M1.id, M2.id, M3.id]);

        await redo();
        expect(markerIds()).toEqual([M1.id, M3.id]);
    });

    it('restores a removed last marker at the end', async () => {
        await addMarkers([M1, M2, M3]);
        await executeAppAction({ type: 'removeMarker', payload: { markerId: M3.id } });

        await undo();

        expect(markerIds()).toEqual([M1.id, M2.id, M3.id]);
    });

    it('restores every marker when undoing a sequence of removals', async () => {
        await addMarkers([M1, M2, M3, M4]);
        const original = markerStore.value?.markers;
        for (const markerId of [M2.id, M4.id, M1.id]) {
            await executeAppAction({ type: 'removeMarker', payload: { markerId } });
        }

        await undo();
        expect(markerIds()).toEqual([M1.id, M3.id]);
        await undo();
        expect(markerIds()).toEqual([M1.id, M3.id, M4.id]);
        await undo();

        expect(markerStore.value?.markers).toEqual(original);
    });

    describe('after a collaborator edits the list before the undo', () => {
        it('restores the marker before its old successor when a peer removed an earlier marker', async () => {
            await addMarkers([M1, M2, M3]);
            await executeAppAction({ type: 'removeMarker', payload: { markerId: M2.id } });
            setPeerMarkers([M3]);

            await undo({ stepOverConflicts: false });

            expect(markerIds()).toEqual([M2.id, M3.id]);
        });

        it('restores the marker before its old successor when a peer reordered the others', async () => {
            await addMarkers([M1, M2, M3]);
            await executeAppAction({ type: 'removeMarker', payload: { markerId: M2.id } });
            setPeerMarkers([M3, M1]);

            await undo({ stepOverConflicts: false });

            expect(markerIds()).toEqual([M2.id, M3.id, M1.id]);
        });

        it('restores a removed last marker after its old predecessor when a peer removed an earlier one', async () => {
            await addMarkers([M1, M2, M3]);
            await executeAppAction({ type: 'removeMarker', payload: { markerId: M3.id } });
            setPeerMarkers([M2]);

            await undo({ stepOverConflicts: false });

            expect(markerIds()).toEqual([M2.id, M3.id]);
        });

        it('falls back to the recorded slot when both neighbours are gone', async () => {
            await addMarkers([M1, M2, M3, M4]);
            await executeAppAction({ type: 'removeMarker', payload: { markerId: M3.id } });
            setPeerMarkers([M1]);

            await undo({ stepOverConflicts: false });

            expect(markerIds()).toEqual([M1.id, M3.id]);
        });

        it('falls back to the recorded slot ahead of the list when the only neighbour is gone', async () => {
            await addMarkers([M1, M2, M3, M4]);
            await executeAppAction({ type: 'removeMarker', payload: { markerId: M1.id } });
            setPeerMarkers([M3, M4]);

            await undo({ stepOverConflicts: false });

            expect(markerIds()).toEqual([M1.id, M3.id, M4.id]);
        });
    });

    it.each([{ index: -1 }, { index: 1.5 }, { index: Number.NaN }, { index: Number.POSITIVE_INFINITY }])(
        'refuses addMarker with malformed index $index without writing',
        async ({ index }) => {
            await addMarkers([M1, M2]);

            await expect(
                executeAppAction({
                    type: 'addMarker',
                    payload: { beat: 24, name: 'M4', markerId: M4.id, index },
                })
            ).rejects.toThrow(/conflicts with current project state/);

            expect(markerIds()).toEqual([M1.id, M2.id]);
        }
    );

    it.each([
        { label: 'non-string beforeId', anchors: '"beforeId":7' },
        { label: 'non-string afterId', anchors: '"afterId":{}' },
    ])('refuses addMarker with a $label without writing', async ({ anchors }) => {
        await addMarkers([M1, M2]);

        await expect(
            executeAppAction({
                type: 'addMarker',
                // The wire shape is untrusted: parsed JSON is the malformed payload under test.
                payload: JSON.parse(`{"beat":24,"name":"M4","markerId":"${M4.id}",${anchors}}`),
            })
        ).rejects.toThrow(/conflicts with current project state/);

        expect(markerIds()).toEqual([M1.id, M2.id]);
    });
});
