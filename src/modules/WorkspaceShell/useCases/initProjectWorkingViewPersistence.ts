import { resetTimelineWorkingView, restoreTimelineWorkingView } from '#/modules/Arrangement/useCases';
import { timelineViewStore } from '#/modules/Arrangement/stores';
import { getSettledProjectId, projectStore } from '#/modules/Project/stores';

import {
    captureProjectWorkingView,
    createDefaultProjectWorkingView,
    projectWorkingViewEquals,
    type ProjectWorkingView,
} from '../models/ProjectWorkingView';
import { readProjectWorkingView, writeProjectWorkingView } from '../repositories/projectWorkingViewStorage';
import { workspaceStore } from '../stores/workspaceStore';

import { updateWorkspaceState } from './workspaceState';

const WRITE_DEBOUNCE_MS = 300;

function captureCurrentView(): ProjectWorkingView | null {
    const workspace = workspaceStore.value;
    const timeline = timelineViewStore.value;
    if (!workspace || !timeline) {
        return null;
    }
    return captureProjectWorkingView({ workspace, timeline });
}

export function initProjectWorkingViewPersistence(): () => void {
    let activeProjectId: string | null = null;
    let transitionKey: string | null = null;
    let durableView: ProjectWorkingView | null = null;
    let writeTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const cancelScheduledWrite = (): void => {
        if (writeTimer !== null) {
            clearTimeout(writeTimer);
            writeTimer = null;
        }
    };

    const flushActiveProject = (): void => {
        cancelScheduledWrite();
        if (!activeProjectId) {
            return;
        }
        const view = captureCurrentView();
        if (!view || (durableView && projectWorkingViewEquals(view, durableView))) {
            return;
        }
        if (writeProjectWorkingView(activeProjectId, view)) {
            durableView = view;
        }
    };

    const scheduleWrite = (): void => {
        if (!activeProjectId || disposed) {
            return;
        }
        const view = captureCurrentView();
        if (!view) {
            return;
        }
        if (durableView && projectWorkingViewEquals(view, durableView)) {
            cancelScheduledWrite();
            return;
        }
        cancelScheduledWrite();
        writeTimer = setTimeout(flushActiveProject, WRITE_DEBOUNCE_MS);
    };

    const resetSessionView = (): void => {
        resetTimelineWorkingView();
        updateWorkspaceState({
            ...createDefaultProjectWorkingView().workspace,
            commandPaletteOpen: false,
            undoHistoryOpen: false,
            collaborationPanelOpen: false,
            branchManagerOpen: false,
            chatPanelOpen: false,
            scratchPadCollapsed: false,
            timelineMinimapPreviewHeight: null,
        });
    };

    const reconcileProject = (): void => {
        const project = projectStore.value;
        const settledProjectId = getSettledProjectId();
        const nextTransitionKey = JSON.stringify([
            project?.projectId ?? null,
            project?.loading ?? null,
            settledProjectId ?? null,
        ]);
        if (nextTransitionKey === transitionKey) {
            return;
        }
        transitionKey = nextTransitionKey;

        // Project loading is published before track teardown, so the outgoing
        // offsets are still clamped against the outgoing arrangement here.
        flushActiveProject();
        activeProjectId = null;
        durableView = null;
        resetSessionView();

        if (disposed || project?.loading !== false || !settledProjectId) {
            return;
        }

        const restored = readProjectWorkingView(settledProjectId) ?? createDefaultProjectWorkingView();
        updateWorkspaceState(restored.workspace);
        restoreTimelineWorkingView(restored.timeline, { deferViewportClamp: true });
        activeProjectId = settledProjectId;
        durableView = captureCurrentView();
    };

    const unsubscribeProject = projectStore.subscribe(reconcileProject);
    const unsubscribeWorkspace = workspaceStore.subscribe(scheduleWrite);
    const unsubscribeTimeline = timelineViewStore.subscribe(scheduleWrite);
    window.addEventListener('pagehide', flushActiveProject);
    reconcileProject();

    return () => {
        if (disposed) {
            return;
        }
        flushActiveProject();
        disposed = true;
        activeProjectId = null;
        durableView = null;
        unsubscribeProject();
        unsubscribeWorkspace();
        unsubscribeTimeline();
        window.removeEventListener('pagehide', flushActiveProject);
    };
}

// The record is deliberately local to this device and project: collaborators
// keep independent working views, and no panel layout enters the shared CRDT.
