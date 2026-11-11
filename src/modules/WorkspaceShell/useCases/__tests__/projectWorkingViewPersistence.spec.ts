import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    setAutoScroll,
    setScrollX,
    setTimelineViewportSize,
    setTimelineZoom,
    timelineViewStore,
} from '#/modules/Arrangement/stores';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import { createDefaultProjectWorkingView, type ProjectWorkingView } from '../../models/ProjectWorkingView';
import { defaultWorkspaceState } from '../../models/WorkspaceState';
import { readProjectWorkingView, writeProjectWorkingView } from '../../repositories/projectWorkingViewStorage';
import { workspaceStore } from '../../stores/workspaceStore';
import { initProjectWorkingViewPersistence } from '../initProjectWorkingViewPersistence';
import { updateWorkspaceState } from '../workspaceState';

vi.mock('../../repositories/projectWorkingViewStorage', () => ({
    readProjectWorkingView: vi.fn(),
    writeProjectWorkingView: vi.fn(),
}));

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';

function publishProject(projectId: string, loading: boolean): void {
    projectStore.set({
        ...structuredClone(defaultProjectStoreState),
        projectId,
        loading,
        initialized: !loading,
        identityMigrationPending: false,
        dirty: false,
    });
}

function savedView(scrollX: number, sidebarWidth: number): ProjectWorkingView {
    const view = createDefaultProjectWorkingView();
    view.timeline.scrollX = scrollX;
    view.workspace.sidebarWidth = sidebarWidth;
    return view;
}

describe('project working view persistence', () => {
    const stops: Array<() => void> = [];

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        vi.mocked(readProjectWorkingView).mockReturnValue(null);
        vi.mocked(writeProjectWorkingView).mockReturnValue(true);
        workspaceStore.set(structuredClone(defaultWorkspaceState));
        timelineViewStore.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
            viewportWidth: 0,
            viewportHeight: 0,
        });
        publishProject(PROJECT_A, false);
    });

    afterEach(() => {
        while (stops.length > 0) {
            stops.pop()?.();
        }
        vi.useRealTimers();
        workspaceStore.set(structuredClone(defaultWorkspaceState));
        timelineViewStore.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
            viewportWidth: 0,
            viewportHeight: 0,
        });
    });

    function start(): void {
        stops.push(initProjectWorkingViewPersistence());
    }

    it('restores the settled project view and closes transient panels', () => {
        const saved = savedView(240, 320);
        saved.timeline.scrollY = 0;
        saved.workspace.mode = 'clip';
        saved.workspace.virtualKeyboardOpen = true;
        vi.mocked(readProjectWorkingView).mockReturnValue(saved);
        workspaceStore.set({
            ...structuredClone(defaultWorkspaceState),
            commandPaletteOpen: true,
            undoHistoryOpen: true,
            collaborationPanelOpen: true,
            branchManagerOpen: true,
            chatPanelOpen: true,
            scratchPadCollapsed: true,
            timelineMinimapPreviewHeight: 80,
        });

        start();

        expect(readProjectWorkingView).toHaveBeenCalledWith(PROJECT_A);
        expect(timelineViewStore.value).toMatchObject({ scrollX: 240, pixelsPerBeat: 12 });
        expect(workspaceStore.value).toMatchObject({
            mode: 'clip',
            sidebarWidth: 320,
            virtualKeyboardOpen: true,
            commandPaletteOpen: false,
            undoHistoryOpen: false,
            collaborationPanelOpen: false,
            branchManagerOpen: false,
            chatPanelOpen: false,
            scratchPadCollapsed: false,
            timelineMinimapPreviewHeight: null,
        });
        expect(writeProjectWorkingView).not.toHaveBeenCalled();
        expect(projectStore.value?.dirty).toBe(false);
    });

    it('keeps existing defaults for a project without a saved view', () => {
        start();

        expect(timelineViewStore.value).toMatchObject({ scrollX: 0, scrollY: 0, pixelsPerBeat: 12 });
        expect(workspaceStore.value).toEqual(defaultWorkspaceState);
        expect(writeProjectWorkingView).not.toHaveBeenCalled();
    });

    it('coalesces persistent changes and ignores viewport and transient-only writes', () => {
        start();

        updateWorkspaceState({ sidebarWidth: 280 });
        setTimelineZoom(24, 4);
        setAutoScroll(false);
        setTimelineViewportSize({ viewportWidth: 800, viewportHeight: 600 });
        updateWorkspaceState({ commandPaletteOpen: true, activeTool: 'draw' });

        vi.advanceTimersByTime(299);
        expect(writeProjectWorkingView).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);

        expect(writeProjectWorkingView).toHaveBeenCalledTimes(1);
        expect(writeProjectWorkingView).toHaveBeenCalledWith(
            PROJECT_A,
            expect.objectContaining({
                timeline: { scrollX: 96, scrollY: 0, pixelsPerBeat: 24 },
                workspace: expect.objectContaining({ sidebarWidth: 280 }),
            })
        );
        const persisted = vi.mocked(writeProjectWorkingView).mock.calls[0]?.[1];
        expect(persisted?.workspace).not.toHaveProperty('commandPaletteOpen');
        expect(persisted?.workspace).not.toHaveProperty('activeTool');
        expect(persisted?.timeline).not.toHaveProperty('autoScrollEnabled');
        expect(persisted?.timeline).not.toHaveProperty('viewportWidth');

        updateWorkspaceState({ undoHistoryOpen: true });
        setAutoScroll(true);
        setTimelineViewportSize({ viewportWidth: 900, viewportHeight: 650 });
        vi.advanceTimersByTime(1000);
        expect(writeProjectWorkingView).toHaveBeenCalledTimes(1);
        expect(projectStore.value?.dirty).toBe(false);
    });

    it('flushes the outgoing project, resets during the switch, and restores each project independently', () => {
        const views = new Map([
            [PROJECT_A, savedView(120, 260)],
            [PROJECT_B, savedView(360, 340)],
        ]);
        vi.mocked(readProjectWorkingView).mockImplementation((projectId) => views.get(projectId) ?? null);
        vi.mocked(writeProjectWorkingView).mockImplementation((projectId, view) => {
            views.set(projectId, structuredClone(view));
            return true;
        });
        start();
        updateWorkspaceState({ sidebarWidth: 300 });
        setScrollX(180);

        publishProject(PROJECT_B, true);

        expect(writeProjectWorkingView).toHaveBeenCalledWith(
            PROJECT_A,
            expect.objectContaining({
                timeline: expect.objectContaining({ scrollX: 180 }),
                workspace: expect.objectContaining({ sidebarWidth: 300 }),
            })
        );
        expect(timelineViewStore.value).toMatchObject({ scrollX: 0, scrollY: 0, pixelsPerBeat: 12 });
        expect(workspaceStore.value?.sidebarWidth).toBe(defaultWorkspaceState.sidebarWidth);

        publishProject(PROJECT_B, false);
        expect(timelineViewStore.value?.scrollX).toBe(360);
        expect(workspaceStore.value?.sidebarWidth).toBe(340);

        publishProject(PROJECT_A, true);
        publishProject(PROJECT_A, false);
        expect(timelineViewStore.value?.scrollX).toBe(180);
        expect(workspaceStore.value?.sidebarWidth).toBe(300);
    });

    it('flushes the latest view on pagehide and disposal without a musical save', () => {
        start();
        updateWorkspaceState({ inspectorWidth: 300 });

        window.dispatchEvent(new PageTransitionEvent('pagehide'));

        expect(writeProjectWorkingView).toHaveBeenCalledTimes(1);
        updateWorkspaceState({ inspectorWidth: 320 });
        stops.pop()?.();
        expect(writeProjectWorkingView).toHaveBeenCalledTimes(2);
        expect(projectStore.value?.dirty).toBe(false);
    });
});
