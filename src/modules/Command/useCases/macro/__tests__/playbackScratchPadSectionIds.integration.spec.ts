import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { registerKernelPorts } from '#/app/registerKernelPorts';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, markerStore, scratchPadStore } from '#/modules/Arrangement/stores';
import { setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    isAppActionConflictError,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    startMacroRecording,
    stopMacroRecording,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { playMacro } from '../playback';

// A capture mints the pad section ids its later edits name. A replayed capture
// mints fresh ones, so playback must map each recorded pad id onto the id the
// replayed capture gave the section at the same position; an unmapped edit
// targets an absent id and drops as a no-op. These rows record through real
// dispatch and replay through the real handler registry and stores.

registerKernelPorts();

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

type ArrangementTrackEvents = {
    'track.removed': { trackId: string };
    'track.selectionChanged': { trackId: string | null; previousTrackId: string | null };
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const RECOLOUR = '#ff0000';

function markerSections(names: readonly string[]) {
    return names.map((name, index) => ({
        id: `marker-${name}`,
        startBeat: index * 8,
        endBeat: (index + 1) * 8,
        name,
        color: '#101010',
    }));
}

function setMarkerSections(names: readonly string[]): void {
    markerStore.set({ markers: [], sections: markerSections(names) });
}

function padSectionsInOrder() {
    const sections = scratchPadStore.value?.sections ?? [];
    return sections.toSorted((left, right) => left.order - right.order);
}

function padSectionIds(): string[] {
    return padSectionsInOrder().map((section) => section.id);
}

function padView(): { name: string; color: string }[] {
    return padSectionsInOrder().map(({ name, color }) => ({ name, color }));
}

async function recordPadEditsMacro(): Promise<{ macroId: string; recordedIds: readonly string[] }> {
    startMacroRecording();
    await executeAppAction({ type: 'captureScratchPad' });
    const recordedIds = padSectionIds();
    const [first, second, third, fourth] = recordedIds;
    if (!first || !second || !third || !fourth) {
        throw new Error('expected the capture to produce four pad sections');
    }
    await executeAppAction({ type: 'renameScratchPadSection', payload: { sectionId: first, name: 'Intro' } });
    await executeAppAction({ type: 'setScratchPadSectionColor', payload: { sectionId: second, color: RECOLOUR } });
    await executeAppAction({ type: 'removeScratchPadSection', payload: { sectionId: third } });
    await executeAppAction({ type: 'reorderScratchPadSection', payload: { sectionId: fourth, direction: 'left' } });
    stopMacroRecording('Pad edits');
    const macro = macroStore.value?.macros.at(-1);
    if (!macro) {
        throw new Error('expected the recording to store a macro');
    }
    // The recorded capture names exactly the ids it wrote.
    expect(macro.actions[0]).toEqual({ type: 'captureScratchPad', payload: { sectionIds: recordedIds } });
    return { macroId: macro.id, recordedIds };
}

/** A replayed capture mints its own ids rather than reusing the recorded ones. */
function expectFreshPadIds(recordedIds: readonly string[]): void {
    const replayedIds = padSectionIds();
    expect(replayedIds.length).toBeGreaterThan(0);
    expect(replayedIds.filter((id) => recordedIds.includes(id))).toEqual([]);
}

async function clearPad(): Promise<void> {
    await executeAppAction({ type: 'clearScratchPad' });
    expect(padView()).toEqual([]);
}

describe('playMacro over scratch pad section edits', () => {
    let unsubscribeFromNotifications: () => void = () => undefined;

    beforeEach(() => {
        Container.clear();
        const notificationEventBus = createEventBus<NotificationEvents>();
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', () => undefined);
        setNotificationEventBus(notificationEventBus);
        setArrangementEventBus(createEventBus<ArrangementTrackEvents>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('scratch pad replay integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        setTrackStoreState(structuredClone(defaultTrackState));
        scratchPadStore.set({ sections: [] });
        setMarkerSections(['A', 'B', 'C', 'D']);
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
        localStorage.removeItem('sourdaw:macros');
    });

    it('records the ids the capture wrote and lands every replayed edit on its section', async () => {
        const { macroId, recordedIds } = await recordPadEditsMacro();
        const recordedEdits = padView();
        expect(recordedEdits).toEqual([
            { name: 'Intro', color: '#101010' },
            { name: 'D', color: '#101010' },
            { name: 'B', color: RECOLOUR },
        ]);
        await clearPad();

        await playMacro(macroId);

        expectFreshPadIds(recordedIds);
        expect(padView()).toEqual(recordedEdits);
    });

    it('maps by position when the markers hold more sections at replay, leaving the extra section untouched', async () => {
        const { macroId, recordedIds } = await recordPadEditsMacro();
        await clearPad();
        setMarkerSections(['A', 'B', 'C', 'D', 'E']);

        await playMacro(macroId);

        expectFreshPadIds(recordedIds);
        expect(padView()).toEqual([
            { name: 'Intro', color: '#101010' },
            { name: 'D', color: '#101010' },
            { name: 'B', color: RECOLOUR },
            { name: 'E', color: '#101010' },
        ]);
    });

    it('maps by position when the markers hold fewer sections at replay, dropping only the edit of the missing one', async () => {
        const { macroId, recordedIds } = await recordPadEditsMacro();
        await clearPad();
        setMarkerSections(['A', 'B', 'C']);

        await playMacro(macroId);

        expectFreshPadIds(recordedIds);
        // The fourth recorded section has no replayed counterpart, so its reorder is a no-op.
        expect(padView()).toEqual([
            { name: 'Intro', color: '#101010' },
            { name: 'B', color: RECOLOUR },
        ]);
    });

    it('replays a stored capture whose recorded ids are malformed to completion, with fresh ids', async () => {
        await executeAppAction({ type: 'captureScratchPad' });
        const [first] = padSectionIds();
        if (!first) {
            throw new Error('expected the capture to produce pad sections');
        }
        await clearPad();
        const storedCapture = { type: 'captureScratchPad', payload: { sectionIds: 5 } } as unknown as AppAction;
        macroStore.set({
            macros: [
                {
                    id: 'malformed-capture',
                    name: 'Malformed capture',
                    actions: [
                        storedCapture,
                        { type: 'renameScratchPadSection', payload: { sectionId: first, name: 'X' } },
                    ],
                    createdAt: 0,
                },
            ],
            recording: false,
            currentRecording: [],
        });

        await expect(playMacro('malformed-capture')).resolves.toBeUndefined();

        const replayedIds = padSectionIds();
        expect(replayedIds).toHaveLength(4);
        expect(replayedIds.every((id) => id.startsWith('scratch-'))).toBe(true);
        expect(replayedIds).not.toContain(first);
        expect(padView().map(({ name }) => name)).toEqual(['A', 'B', 'C', 'D']);
    });

    it.each([
        ['a repeated id', ['x', 'x']],
        ['an empty id', ['']],
        ['a non-string id', [42]],
        ['a string in place of a list', 'ab'],
        // Falsy, so a presence test by truthiness would mint fresh ids over it.
        ['an empty string in place of a list', ''],
    ] as const)(
        'refuses a dispatched capture carrying %s, leaving the pad, the undo history and the pad panel as they were',
        async (_label, sectionIds) => {
            scratchPadStore.set({
                sections: [{ id: 'old-pad', startBeat: 0, endBeat: 4, name: 'Old', color: '#333333', order: 0 }],
            });
            const padBefore = structuredClone(scratchPadStore.value);
            workspaceStore.set({ ...defaultWorkspaceState, scratchPadOpen: false });
            const undoDepthBefore = undoHistoryStore.value?.past.length;
            const malformed = { type: 'captureScratchPad', payload: { sectionIds } } as unknown as AppAction;

            await expect(executeAppAction(malformed)).rejects.toSatisfy(isAppActionConflictError);

            expect(scratchPadStore.value).toEqual(padBefore);
            expect(undoHistoryStore.value?.past.length).toBe(undoDepthBefore);
            expect(workspaceStore.value?.scratchPadOpen).toBe(false);
        }
    );

    it('leaves a pad id captured before recording began unmapped, so its edit is a no-op once that id is gone', async () => {
        await executeAppAction({ type: 'captureScratchPad' });
        const [first] = padSectionIds();
        if (!first) {
            throw new Error('expected the capture to produce pad sections');
        }
        startMacroRecording();
        await executeAppAction({ type: 'renameScratchPadSection', payload: { sectionId: first, name: 'Intro' } });
        stopMacroRecording('Rename only');
        const macroId = macroStore.value?.macros.at(-1)?.id;
        expect(macroStore.value?.macros.at(-1)?.actions).toEqual([
            { type: 'renameScratchPadSection', payload: { sectionId: first, name: 'Intro' } },
        ]);
        await clearPad();
        await executeAppAction({ type: 'captureScratchPad' });
        const recapturedIds = padSectionIds();
        expect(recapturedIds).not.toContain(first);

        await playMacro(macroId ?? '');

        expect(padSectionIds()).toEqual(recapturedIds);
        expect(padView().map(({ name }) => name)).toEqual(['A', 'B', 'C', 'D']);
    });
});
