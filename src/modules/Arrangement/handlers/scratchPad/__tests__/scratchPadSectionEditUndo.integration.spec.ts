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
    revertAction,
    setActionHistoryMetadataPort,
    syncActionReplayMetadata,
    undo,
} from '#/modules/Command/useCases';
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
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { type ScratchPadSection } from '../../../models/ScratchPadSection';

// The four per-section scratch pad edits (remove, rename, reorder, recolour) must each
// record an undo entry whose inverse restores the exact prior pad. Real handlers, stores,
// and dispatch through executeAppAction / undo / redo.

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

// Distinct durations, names and colours so a reorder's beat reflow and every field are observable.
const VERSE: ScratchPadSection = {
    id: 'scratch-verse',
    startBeat: 0,
    endBeat: 8,
    name: 'Verse',
    color: '#aa0000',
    order: 0,
};
const CHORUS: ScratchPadSection = {
    id: 'scratch-chorus',
    startBeat: 8,
    endBeat: 20,
    name: 'Chorus',
    color: '#00aa00',
    order: 1,
};
const BRIDGE: ScratchPadSection = {
    id: 'scratch-bridge',
    startBeat: 20,
    endBeat: 24,
    name: 'Bridge',
    color: '#0000aa',
    order: 2,
};

type EditScenario = {
    readonly label: string;
    readonly action: AppAction;
    readonly expectedAfter: readonly ScratchPadSection[];
};

const EDITS: readonly EditScenario[] = [
    {
        label: 'remove',
        action: { type: 'removeScratchPadSection', payload: { sectionId: CHORUS.id } },
        expectedAfter: [VERSE, { ...BRIDGE, order: 1 }],
    },
    {
        label: 'rename',
        action: { type: 'renameScratchPadSection', payload: { sectionId: CHORUS.id, name: 'Hook' } },
        expectedAfter: [VERSE, { ...CHORUS, name: 'Hook' }, BRIDGE],
    },
    {
        label: 'reorder',
        action: { type: 'reorderScratchPadSection', payload: { sectionId: CHORUS.id, direction: 'left' } },
        expectedAfter: [
            { ...CHORUS, startBeat: 0, endBeat: 12, order: 0 },
            { ...VERSE, startBeat: 12, endBeat: 20, order: 1 },
            BRIDGE,
        ],
    },
    {
        label: 'recolour',
        action: { type: 'setScratchPadSectionColor', payload: { sectionId: CHORUS.id, color: '#ffffff' } },
        expectedAfter: [VERSE, { ...CHORUS, color: '#ffffff' }, BRIDGE],
    },
];

describe('scratch pad section edits are undoable', () => {
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
        resetCrdtProjectAuthority('scratch pad section edit undo integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        markerStore.set({ markers: [], sections: [] });
        scratchPadStore.set({ sections: structuredClone([VERSE, CHORUS, BRIDGE]) });
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

    const padSections = () => scratchPadStore.value?.sections;

    describe.each(EDITS)('$label', ({ action, expectedAfter }) => {
        it('undo restores the exact prior pad, redo reapplies the edit, and undo restores it again', async () => {
            const before = structuredClone(padSections());

            await executeAppAction(action);
            expect(padSections()).toEqual(expectedAfter);

            await undo({ stepOverConflicts: false });
            expect(padSections()).toEqual(before);
            expect(padSections()).toEqual([VERSE, CHORUS, BRIDGE]);

            await redo();
            expect(padSections()).toEqual(expectedAfter);

            await undo({ stepOverConflicts: false });
            expect(padSections()).toEqual(before);
            expect(notifications.map((notification) => notification.message)).toEqual([]);
        });
    });

    it('undoes a pad edit after an unrelated section added later was undone first', async () => {
        await executeAppAction({
            type: 'renameScratchPadSection',
            payload: { sectionId: CHORUS.id, name: 'Hook' },
        });
        await executeAppAction({
            type: 'addSection',
            payload: { startBeat: 0, endBeat: 8, name: 'Intro', sectionId: 'sec-intro', color: '#aa0000' },
        });

        await undo({ stepOverConflicts: false });
        await undo({ stepOverConflicts: false });

        expect(padSections()).toEqual([VERSE, CHORUS, BRIDGE]);
        expect(markerStore.value?.sections).toEqual([]);
    });

    describe('reverting an older pad edit out of order from the action history', () => {
        let unsubscribeFromHistory: () => void = () => undefined;

        beforeEach(() => {
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
        });

        afterEach(() => {
            unsubscribeFromHistory();
            unsubscribeFromHistory = () => undefined;
            clearActionHistory();
        });

        it('refuses and keeps the later pad edit', async () => {
            await executeAppAction({
                type: 'renameScratchPadSection',
                payload: { sectionId: VERSE.id, name: 'Intro' },
            });
            await executeAppAction({
                type: 'renameScratchPadSection',
                payload: { sectionId: CHORUS.id, name: 'Hook' },
            });
            const afterBoth = structuredClone(padSections());
            const firstRename = actionHistoryStore.value?.entries.find(
                (entry) => entry.actionKind === 'renameScratchPadSection'
            );
            if (!firstRename) {
                throw new Error('Expected the first pad rename in the action history');
            }

            await expect(revertAction(firstRename.id)).resolves.toEqual({ status: 'conflict' });

            expect(padSections()).toEqual(afterBoth);
        });
    });

    describe('with a marker section edit reverted out of order from the action history', () => {
        let unsubscribeFromHistory: () => void = () => undefined;

        beforeEach(() => {
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
        });

        afterEach(() => {
            unsubscribeFromHistory();
            unsubscribeFromHistory = () => undefined;
            clearActionHistory();
        });

        it('restoring a pad rename leaves a marker name reverted since the capture alone', async () => {
            const intro = { id: 'sec-intro', startBeat: 0, endBeat: 8, name: 'Intro', color: '#aa0000' };
            await executeAppAction({
                type: 'addSection',
                payload: {
                    startBeat: intro.startBeat,
                    endBeat: intro.endBeat,
                    name: intro.name,
                    sectionId: intro.id,
                    color: intro.color,
                },
            });
            await executeAppAction({ type: 'renameSection', payload: { sectionId: intro.id, name: 'Verse' } });
            await executeAppAction({
                type: 'renameScratchPadSection',
                payload: { sectionId: CHORUS.id, name: 'Hook' },
            });
            const markerRename = actionHistoryStore.value?.entries.find(
                (entry) => entry.actionKind === 'renameSection'
            );
            if (!markerRename) {
                throw new Error('Expected the marker rename in the action history');
            }

            await expect(revertAction(markerRename.id)).resolves.toEqual({ status: 'executed' });
            expect(markerStore.value?.sections.map((section) => section.name)).toEqual(['Intro']);

            // The revert is itself undoable and sits on top of the stack, so undo the pad rename
            // through the action history too: it runs the same guarded restore.
            const padRename = actionHistoryStore.value?.entries.find(
                (entry) => entry.actionKind === 'renameScratchPadSection'
            );
            if (!padRename) {
                throw new Error('Expected the pad rename in the action history');
            }
            await expect(revertAction(padRename.id)).resolves.toEqual({ status: 'executed' });

            expect(padSections()).toEqual([VERSE, CHORUS, BRIDGE]);
            expect(markerStore.value?.sections.map((section) => section.name)).toEqual(['Intro']);
        });
    });

    it('refuses an undo whose pad diverged underneath, writes nothing, and leaves redo with nothing to reapply', async () => {
        await executeAppAction({
            type: 'renameScratchPadSection',
            payload: { sectionId: CHORUS.id, name: 'Hook' },
        });
        const renamed = [VERSE, { ...CHORUS, name: 'Hook' }, BRIDGE];
        // Another writer removes a section directly, so the id sequence no longer matches.
        const diverged = renamed.filter((section) => section.id !== BRIDGE.id);
        scratchPadStore.set({ sections: structuredClone(diverged) });

        const refused = await undo({ stepOverConflicts: false });

        expect(refused).toEqual({ headConsumed: false });
        expect(padSections()).toEqual(diverged);
        expect(notifications.length).toBeGreaterThan(0);

        // The refused entry stays on the past stack, so there is nothing on the future stack to redo.
        await redo();
        expect(padSections()).toEqual(diverged);
    });
});
