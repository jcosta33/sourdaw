import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, markerStore, scratchPadStore } from '#/modules/Arrangement/stores';
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

// Undoing removeSection re-adds the section through `addSection`, which appends.
// Removing a non-last section therefore reorders markerStore.sections on undo, and
// restoreScratchPadState compares marker section ids by sequence, so an older
// Clear Scratch Pad undo then refuses as a conflict. Real handlers, stores, dispatch.

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

const A = { id: 'sec-a', startBeat: 0, endBeat: 8, name: 'A', color: '#aa0000' };
const B = { id: 'sec-b', startBeat: 8, endBeat: 16, name: 'B', color: '#00aa00' };
const C = { id: 'sec-c', startBeat: 16, endBeat: 24, name: 'C', color: '#0000aa' };
const D = { id: 'sec-d', startBeat: 24, endBeat: 32, name: 'D', color: '#aaaa00' };

type SectionRow = typeof A;

async function addSections(rows: readonly SectionRow[]): Promise<void> {
    for (const row of rows) {
        await executeAppAction({
            type: 'addSection',
            payload: {
                startBeat: row.startBeat,
                endBeat: row.endBeat,
                name: row.name,
                sectionId: row.id,
                color: row.color,
            },
        });
    }
}

describe('removeSection undo restores section order', () => {
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
        resetCrdtProjectAuthority('remove section undo order integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        markerStore.set({ markers: [], sections: [] });
        scratchPadStore.set({ sections: [] });
        setTrackStoreState(structuredClone(defaultTrackState));
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setTrackStoreState(structuredClone(defaultTrackState));
        markerStore.set({ markers: [], sections: [] });
        scratchPadStore.set({ sections: [] });
        unsubscribeFromNotifications();
        unsubscribeFromNotifications = () => undefined;
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    const sectionRows = () => markerStore.value?.sections;
    const sectionIds = () => markerStore.value?.sections.map((section) => section.id);

    it('restores the first of two sections to its original position', async () => {
        await addSections([A, B]);
        const before = sectionRows();
        await executeAppAction({ type: 'removeSection', payload: { sectionId: A.id } });
        expect(sectionIds()).toEqual([B.id]);

        await undo();

        expect(sectionIds()).toEqual([A.id, B.id]);
        expect(sectionRows()).toEqual(before);
        expect(sectionRows()?.[0]).toEqual(A);
    });

    it('restores the middle of three sections to its original position', async () => {
        await addSections([A, B, C]);
        const before = sectionRows();
        await executeAppAction({ type: 'removeSection', payload: { sectionId: B.id } });
        expect(sectionIds()).toEqual([A.id, C.id]);

        await undo();

        expect(sectionIds()).toEqual([A.id, B.id, C.id]);
        expect(sectionRows()).toEqual(before);
    });

    it.each([
        {
            order: [B, D, A].map((row) => row.id),
            // Undo order is the reverse of removal: A first, then D, then B.
            expectedAfterFirstUndo: [A.id, C.id],
            expectedAfterSecondUndo: [A.id, C.id, D.id],
        },
        {
            order: [C, A, B].map((row) => row.id),
            expectedAfterFirstUndo: [B.id, D.id],
            expectedAfterSecondUndo: [A.id, B.id, D.id],
        },
    ])('restores every section when undoing a sequence of removals (removed: $order)', async (scenario) => {
        await addSections([A, B, C, D]);
        const original = sectionRows();
        for (const sectionId of scenario.order) {
            await executeAppAction({ type: 'removeSection', payload: { sectionId } });
        }
        expect(sectionIds()).toEqual([A, B, C, D].map((row) => row.id).filter((id) => !scenario.order.includes(id)));

        await undo();
        expect(sectionIds()).toEqual(scenario.expectedAfterFirstUndo);
        await undo();
        expect(sectionIds()).toEqual(scenario.expectedAfterSecondUndo);
        await undo();

        expect(sectionIds()).toEqual([A.id, B.id, C.id, D.id]);
        expect(sectionRows()).toEqual(original);
    });

    it('keeps one copy of a section re-added before its removal is undone, and redoes cleanly', async () => {
        await addSections([A, B, C]);
        await executeAppAction({ type: 'removeSection', payload: { sectionId: B.id } });
        // A collaborator re-creates the same section id at the end before this undo runs.
        const currentSections = markerStore.value?.sections;
        if (!currentSections) {
            throw new Error('expected marker store sections to be initialized');
        }
        markerStore.set({ markers: [], sections: [...currentSections, B] });
        expect(sectionIds()).toEqual([A.id, C.id, B.id]);

        await undo({ stepOverConflicts: false });
        expect(sectionIds()).toEqual([A.id, C.id, B.id]);

        await redo();
        expect(sectionIds()).toEqual([A.id, C.id]);
        await undo({ stepOverConflicts: false });
        expect(sectionIds()).toEqual([A.id, B.id, C.id]);
    });

    describe('after a collaborator edits the list before the undo', () => {
        const removePeerSection = (sectionId: string) => {
            const current = markerStore.value;
            if (!current) {
                throw new Error('expected marker store to be initialized');
            }
            markerStore.set({ ...current, sections: current.sections.filter((section) => section.id !== sectionId) });
        };

        it('restores the section before its old successor when a peer removed an earlier section', async () => {
            await addSections([A, B, C]);
            await executeAppAction({ type: 'removeSection', payload: { sectionId: B.id } });
            removePeerSection(A.id);
            expect(sectionIds()).toEqual([C.id]);

            await undo({ stepOverConflicts: false });

            expect(sectionIds()).toEqual([B.id, C.id]);
        });

        it('restores the section before its old successor when a peer reordered the others', async () => {
            await addSections([A, B, C]);
            await executeAppAction({ type: 'removeSection', payload: { sectionId: B.id } });
            const current = markerStore.value;
            if (!current) {
                throw new Error('expected marker store to be initialized');
            }
            markerStore.set({ ...current, sections: [C, A] });

            await undo({ stepOverConflicts: false });

            expect(sectionIds()).toEqual([B.id, C.id, A.id]);
        });

        it('restores a removed last section after its old predecessor when a peer removed an earlier one', async () => {
            await addSections([A, B, C]);
            await executeAppAction({ type: 'removeSection', payload: { sectionId: C.id } });
            removePeerSection(A.id);

            await undo({ stepOverConflicts: false });

            expect(sectionIds()).toEqual([B.id, C.id]);
        });

        it('falls back to the recorded slot when both neighbours are gone', async () => {
            await addSections([A, B, C, D]);
            await executeAppAction({ type: 'removeSection', payload: { sectionId: C.id } });
            removePeerSection(B.id);
            removePeerSection(D.id);
            expect(sectionIds()).toEqual([A.id]);

            await undo({ stepOverConflicts: false });

            expect(sectionIds()).toEqual([A.id, C.id]);
        });

        it('falls back to the recorded slot ahead of the list when the only neighbour is gone', async () => {
            await addSections([A, B, C, D]);
            await executeAppAction({ type: 'removeSection', payload: { sectionId: A.id } });
            removePeerSection(B.id);
            expect(sectionIds()).toEqual([C.id, D.id]);

            await undo({ stepOverConflicts: false });

            expect(sectionIds()).toEqual([A.id, C.id, D.id]);
        });
    });

    it.each([
        { label: 'non-string beforeId', anchors: '{"beforeId":7}' },
        { label: 'non-string afterId', anchors: '{"afterId":{}}' },
    ])('refuses addSection with a $label without writing', async ({ anchors }) => {
        await addSections([A, B, C]);

        await expect(
            executeAppAction({
                type: 'addSection',
                // The wire shape is untrusted: parsed JSON is the malformed payload under test.
                payload: JSON.parse(
                    `{"startBeat":24,"endBeat":32,"name":"D","sectionId":"${D.id}",${anchors.slice(1, -1)}}`
                ),
            })
        ).rejects.toThrow(/conflicts with current project state/);

        expect(sectionIds()).toEqual([A.id, B.id, C.id]);
    });

    it.each([{ index: -1 }, { index: 1.5 }, { index: Number.NaN }, { index: Number.POSITIVE_INFINITY }])(
        'refuses addSection with malformed index $index without writing',
        async ({ index }) => {
            await addSections([A, B, C]);

            await expect(
                executeAppAction({
                    type: 'addSection',
                    payload: { startBeat: 24, endBeat: 32, name: 'D', sectionId: D.id, index },
                })
            ).rejects.toThrow(/conflicts with current project state/);

            expect(sectionIds()).toEqual([A.id, B.id, C.id]);
        }
    );

    describe('with an older Clear Scratch Pad on the history', () => {
        async function removeAfterClear(): Promise<ReturnType<typeof structuredClone<typeof scratchPadStore.value>>> {
            await addSections([A, B]);
            await executeAppAction({ type: 'captureScratchPad' });
            const capturedPad = structuredClone(scratchPadStore.value);
            expect(capturedPad?.sections.length).toBe(2);
            await executeAppAction({ type: 'clearScratchPad' });
            expect(scratchPadStore.value?.sections).toEqual([]);
            await executeAppAction({ type: 'removeSection', payload: { sectionId: A.id } });
            expect(sectionIds()).toEqual([B.id]);
            return capturedPad;
        }

        it('undoes the remove then the Clear without a conflict', async () => {
            const capturedPad = await removeAfterClear();

            await undo({ stepOverConflicts: false });
            expect(sectionIds()).toEqual([A.id, B.id]);

            const clearUndo = await undo({ stepOverConflicts: false });

            expect(clearUndo).toEqual({ headConsumed: true });
            expect(scratchPadStore.value?.sections).toEqual(capturedPad?.sections);
            expect(sectionIds()).toEqual([A.id, B.id]);
            expect(notifications.map((notification) => notification.message)).toEqual([]);
        });

        it('redoes the Clear then the remove', async () => {
            await removeAfterClear();
            await undo({ stepOverConflicts: false });
            await undo({ stepOverConflicts: false });

            await redo();
            expect(scratchPadStore.value?.sections).toEqual([]);
            expect(sectionIds()).toEqual([A.id, B.id]);

            await redo();
            expect(sectionIds()).toEqual([B.id]);
            expect(scratchPadStore.value?.sections).toEqual([]);
        });
    });
});
