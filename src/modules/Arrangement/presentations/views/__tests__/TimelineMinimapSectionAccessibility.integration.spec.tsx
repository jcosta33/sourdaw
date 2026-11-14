import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    projectCrdtToStores,
    recordActionHistoryEntry,
    recordActionHistoryEntries,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';

import { markerStore } from '../../../stores/markerStore';
import { timelineViewStore } from '../../../stores/timelineViewStore';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { TimelineMinimap } from '../TimelineMinimap';

type Project = { markers: NonNullable<typeof markerStore.value> };
let stopProjectionBridge: () => void;

function expectSectionState(name: string, startBeat: number, endBeat: number): void {
    act(() => flushAutomergeStorageWrites());
    const project = getCrdtDoc<Project>('root');
    expect(project?.markers).toEqual(markerStore.value);
    expect(project?.markers.sections.find((section) => section.id === 'intro')).toMatchObject({
        name,
        startBeat,
        endBeat,
    });
}

describe('mounted minimap section descriptions follow project history', () => {
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('minimap section accessibility integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        sessionStorage.removeItem('sourdaw-undo-session');
        clearHandlerRegistry();
        const arrangement = getArrangementHandlers();
        const transport = getTransportHandlers();
        registerHandlerMap({
            addSection: arrangement.addSection,
            removeSection: arrangement.removeSection,
            renameSection: arrangement.renameSection,
            resizeSection: arrangement.resizeSection,
            addTimeSignatureChange: transport.addTimeSignatureChange,
        });
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            recordBatch: recordActionHistoryEntries,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        transportStore.set({ ...defaultTransportState, isPlaying: false });
        timeSignatureMapStore.set({ changes: [] });
        trackStore.set({ tracks: [], selectedTrackId: null });
        timelineViewStore.set({ scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true });
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 120, 18));
        await executeAppAction({
            type: 'addSection',
            payload: { sectionId: 'intro', name: 'Intro', startBeat: 0, endBeat: 16 },
        });
        await executeAppAction({
            type: 'addSection',
            payload: { sectionId: 'outro', name: 'Outro', startBeat: 160, endBeat: 240 },
        });
        clearUndoHistory();
    });

    afterEach(() => {
        cleanup();
        flushAutomergeStorageWrites();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        stopProjectionBridge();
        configureAutomergeStoragePort(null);
        sessionStorage.removeItem('sourdaw-undo-session');
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('updates the same accessible slider through real rename, resize, Undo and Redo', async () => {
        render(<TimelineMinimap height={18} />);
        const slider = screen.getByRole('slider');
        const original = 'Sections: Intro, start 1.1.1, end 5.1.1. Outro, start 41.1.1, end 61.1.1.';
        expect(slider).toHaveAccessibleDescription(original);
        expectSectionState('Intro', 0, 16);

        await act(async () => {
            await executeAppAction({ type: 'renameSection', payload: { sectionId: 'intro', name: 'Opening' } });
        });
        const renamed = 'Sections: Opening, start 1.1.1, end 5.1.1. Outro, start 41.1.1, end 61.1.1.';
        expect(slider).toHaveAccessibleDescription(renamed);
        expectSectionState('Opening', 0, 16);
        expect(undoHistoryStore.value?.past).toHaveLength(1);

        await act(async () => {
            await executeAppAction({
                type: 'resizeSection',
                payload: { sectionId: 'intro', startBeat: 4, endBeat: 12 },
            });
        });
        const resized = 'Sections: Opening, start 2.1.1, end 4.1.1. Outro, start 41.1.1, end 61.1.1.';
        expect(slider).toHaveAccessibleDescription(resized);
        expectSectionState('Opening', 4, 12);
        expect(undoHistoryStore.value?.past).toHaveLength(2);

        await act(async () => {
            await undo();
        });
        expect(slider).toHaveAccessibleDescription(renamed);
        expectSectionState('Opening', 0, 16);
        await act(async () => {
            await undo();
        });
        expect(slider).toHaveAccessibleDescription(original);
        expectSectionState('Intro', 0, 16);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(undoHistoryStore.value?.future).toHaveLength(2);

        await act(async () => {
            await redo();
        });
        expect(slider).toHaveAccessibleDescription(renamed);
        expectSectionState('Opening', 0, 16);
        await act(async () => {
            await redo();
        });
        expect(slider).toHaveAccessibleDescription(resized);
        expectSectionState('Opening', 4, 12);
        expect(undoHistoryStore.value?.past).toHaveLength(2);
        expect(undoHistoryStore.value?.future).toHaveLength(0);

        fireEvent.keyDown(slider, { key: 'ArrowRight' });
        expect(timelineViewStore.value?.scrollX).toBe(48);
        expect(screen.getByRole('slider')).toBe(slider);
        expect(slider).toHaveAccessibleDescription(resized);
    });

    it('reformats the mounted description after a real meter-map action', async () => {
        render(<TimelineMinimap />);
        const slider = screen.getByRole('slider');
        expect(slider).toHaveAccessibleDescription(
            'Sections: Intro, start 1.1.1, end 5.1.1. Outro, start 41.1.1, end 61.1.1.'
        );

        await act(async () => {
            await executeAppAction({
                type: 'addTimeSignatureChange',
                payload: { beat: 0, numerator: 3, denominator: 4 },
            });
        });

        expect(slider).toHaveAccessibleDescription(
            'Sections: Intro, start 1.1.1, end 6.2.1. Outro, start 54.2.1, end 81.1.1.'
        );
        expectSectionState('Intro', 0, 16);
        expect(transportStore.value?.timeSignatureNumerator).toBe(4);
    });
});
