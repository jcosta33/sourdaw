import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNativeApplicationMenu } from '../useNativeApplicationMenu';

type NativeMenuIntent = Parameters<Parameters<SourdawDesktopBridge['nativeMenu']['listen']>[0]>[0];

const desktop = vi.hoisted(() => ({
    listener: undefined as ((intent: NativeMenuIntent) => void) | undefined,
    projectState: vi.fn(async () => undefined),
    saveResult: vi.fn(async () => undefined),
    edit: vi.fn(async () => undefined),
}));
const projectState = vi.hoisted(() => ({ dirty: false, identityPersistencePending: false }));
const crdt = vi.hoisted(() => ({
    captureProjectRevision: vi.fn(() => 'revision-1'),
    subscribeToCrdtChanges: vi.fn(() => () => undefined),
}));
const projectActions = vi.hoisted(() => ({
    saveProject: vi.fn(async () => true),
    discardProjectChanges: vi.fn(async () => true),
    newProject: vi.fn(),
    pickAndImportProjectFile: vi.fn(async () => true),
    exportProjectFile: vi.fn(async () => undefined),
    getRecentProjects: vi.fn(() => []),
    loadRecentProject: vi.fn(async () => 'committed'),
    recentProjectChanges: { subscribe: vi.fn((_listener: () => void) => () => undefined) },
}));

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: () => true,
    desktopNativeMenu: () => ({
        listen: (listener: (intent: NativeMenuIntent) => void) => {
            desktop.listener = listener;
            return () => {
                desktop.listener = undefined;
            };
        },
        projectState: desktop.projectState,
        saveResult: desktop.saveResult,
        edit: desktop.edit,
    }),
}));

vi.mock('#/modules/Project/stores', () => ({
    projectStore: {
        get value() {
            return {
                projectId: 'project',
                dirty: projectState.dirty,
                identityPersistencePending: projectState.identityPersistencePending,
            };
        },
    },
}));
vi.mock('#/modules/Project/useCases', () => projectActions);
vi.mock('#/modules/CrdtDocument/useCases', () => crdt);
const tracks = vi.hoisted(() => ({
    value: [
        {
            clips: [{ id: 'clip-a' }, { id: 'clip-b' }],
        },
    ],
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return { tracks: tracks.value };
        },
    },
}));
const arrangement = vi.hoisted(() => ({
    clearClipSelection: vi.fn(),
    selectAllClips: vi.fn(),
    zoomTimelineBy: vi.fn(),
}));
vi.mock('#/modules/Arrangement/useCases', () => arrangement);
const workspace = vi.hoisted(() => ({
    openExportDialog: vi.fn(),
    openPreferencesDialog: vi.fn(),
    toggleInspector: vi.fn(),
    toggleMixer: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleTrackList: vi.fn(),
    toggleVirtualKeyboard: vi.fn(),
    toggleAutomationPanel: vi.fn(),
    toggleChatPanel: vi.fn(),
    zoomToFit: vi.fn(),
    zoomToSelection: vi.fn(),
}));
vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    ...workspace,
}));
const command = vi.hoisted(() => ({ executeAppAction: vi.fn(async () => undefined), undo: vi.fn(), redo: vi.fn() }));
vi.mock('#/modules/Command/useCases', () => command);
const onboarding = vi.hoisted(() => ({ startOnboardingTour: vi.fn() }));
vi.mock('#/modules/Onboarding/useCases', () => onboarding);

describe('useNativeApplicationMenu', () => {
    beforeEach(() => {
        desktop.listener = undefined;
        desktop.projectState.mockClear();
        desktop.saveResult.mockClear();
        desktop.edit.mockClear();
        projectState.dirty = false;
        projectState.identityPersistencePending = false;
        crdt.captureProjectRevision.mockClear();
        crdt.captureProjectRevision.mockReturnValue('revision-1');
        crdt.subscribeToCrdtChanges.mockClear();
        projectActions.saveProject.mockReset();
        projectActions.saveProject.mockResolvedValue(true);
        projectActions.discardProjectChanges.mockReset();
        projectActions.discardProjectChanges.mockResolvedValue(true);
        projectActions.newProject.mockClear();
        projectActions.loadRecentProject.mockClear();
        projectActions.recentProjectChanges.subscribe.mockClear();
        arrangement.zoomTimelineBy.mockClear();
        arrangement.clearClipSelection.mockClear();
        arrangement.selectAllClips.mockClear();
        command.executeAppAction.mockClear();
        command.undo.mockClear();
        command.redo.mockClear();
        onboarding.startOnboardingTour.mockClear();
        for (const action of Object.values(workspace)) {
            action.mockClear();
        }
    });

    it('projects the active project and routes text editing through the narrow native capability', async () => {
        renderHook(() =>
            useNativeApplicationMenu({
                projectId: 'project',
                name: 'Song',
                createdAt: 1,
                updatedAt: 2,
                dirty: true,
                loading: false,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        expect(desktop.projectState).toHaveBeenCalledWith({
            title: 'Song',
            dirty: true,
            durabilityPending: false,
            projectId: 'project',
            revision: 'revision-1',
            recentProjects: [],
        });
        const input = document.createElement('input');
        document.body.append(input);
        input.focus();
        desktop.listener?.({ action: 'edit:copy' });
        desktop.listener?.({ action: 'edit:undo' });
        desktop.listener?.({ action: 'edit:redo' });

        await vi.waitFor(() => expect(desktop.edit).toHaveBeenCalledWith('copy'));
        expect(desktop.edit).toHaveBeenCalledWith('undo');
        expect(desktop.edit).toHaveBeenCalledWith('redo');
        input.remove();
    });

    it('dispatches DAW clipboard editing through the typed action path when no text field owns focus', async () => {
        renderHook(() =>
            useNativeApplicationMenu({
                projectId: 'project',
                name: 'Song',
                createdAt: 1,
                updatedAt: 2,
                dirty: false,
                loading: false,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );
        desktop.listener?.({ action: 'edit:cut' });
        await vi.waitFor(() => expect(command.executeAppAction).toHaveBeenCalledWith({ type: 'cutClip' }));
    });

    it('routes timeline zoom through the Arrangement use case', async () => {
        renderHook(() =>
            useNativeApplicationMenu({
                projectId: 'project',
                name: 'Song',
                createdAt: 1,
                updatedAt: 2,
                dirty: false,
                loading: false,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        desktop.listener?.({ action: 'view:zoom-in' });
        desktop.listener?.({ action: 'view:zoom-out' });

        await vi.waitFor(() => expect(arrangement.zoomTimelineBy).toHaveBeenCalledWith(4));
        expect(arrangement.zoomTimelineBy).toHaveBeenCalledWith(-4);
    });

    it('does not report an ordinary File save as a close-save response', async () => {
        renderHook(() =>
            useNativeApplicationMenu({
                projectId: 'project',
                name: 'Song',
                createdAt: 1,
                updatedAt: 2,
                dirty: false,
                loading: false,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        desktop.listener?.({ action: 'project:save' });

        await vi.waitFor(() => expect(projectActions.saveProject).toHaveBeenCalledTimes(1));
        expect(desktop.saveResult).not.toHaveBeenCalled();
    });

    it('reports a correlated save as dirty when a concurrent edit remains live', async () => {
        projectState.dirty = true;
        renderHook(() =>
            useNativeApplicationMenu({
                projectId: 'project',
                name: 'Song',
                createdAt: 1,
                updatedAt: 2,
                dirty: true,
                loading: false,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        desktop.listener?.({ action: 'project:save', requestId: 8, projectId: 'project', revision: 'revision-1' });

        await vi.waitFor(() =>
            expect(desktop.saveResult).toHaveBeenCalledWith({ requestId: 8, saved: true, dirty: true })
        );
    });

    it('rejects a correlated save when its expected renderer authority is stale', async () => {
        renderHook(() =>
            useNativeApplicationMenu({
                projectId: 'project',
                name: 'Song',
                createdAt: 1,
                updatedAt: 2,
                dirty: true,
                loading: false,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );
        crdt.captureProjectRevision.mockReturnValue('revision-2');

        desktop.listener?.({ action: 'project:save', requestId: 8, projectId: 'project', revision: 'revision-1' });

        await vi.waitFor(() =>
            expect(desktop.saveResult).toHaveBeenCalledWith({ requestId: 8, saved: false, dirty: true })
        );
        expect(projectActions.saveProject).not.toHaveBeenCalled();
    });

    it('reports a clean correlated save only after project identity persistence is durable', async () => {
        projectState.identityPersistencePending = true;
        projectActions.saveProject.mockImplementation(async () => {
            projectState.identityPersistencePending = false;
            return true;
        });
        renderHook(() =>
            useNativeApplicationMenu({
                projectId: 'project',
                name: 'Song',
                createdAt: 1,
                updatedAt: 2,
                dirty: false,
                identityPersistencePending: true,
                loading: false,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        desktop.listener?.({ action: 'project:save', requestId: 9, projectId: 'project', revision: 'revision-1' });

        await vi.waitFor(() =>
            expect(desktop.saveResult).toHaveBeenCalledWith({ requestId: 9, saved: true, dirty: false })
        );
    });

    it('returns a correlated clean result after discarding a close request', async () => {
        renderHook(() =>
            useNativeApplicationMenu({
                projectId: 'project',
                name: 'Song',
                createdAt: 1,
                updatedAt: 2,
                dirty: true,
                loading: false,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        desktop.listener?.({ action: 'project:discard', requestId: 7, projectId: 'project', revision: 'revision-1' });

        await vi.waitFor(() => expect(projectActions.discardProjectChanges).toHaveBeenCalledTimes(1));
        expect(desktop.saveResult).toHaveBeenCalledWith({ requestId: 7, saved: true, dirty: false });
    });

    it('rejects a discard request whose renderer revision has changed before it begins', async () => {
        renderHook(() =>
            useNativeApplicationMenu({
                projectId: 'project',
                name: 'Song',
                createdAt: 1,
                updatedAt: 2,
                dirty: true,
                loading: false,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );
        crdt.captureProjectRevision.mockReturnValue('revision-2');

        desktop.listener?.({ action: 'project:discard', requestId: 7, projectId: 'project', revision: 'revision-1' });

        await vi.waitFor(() =>
            expect(desktop.saveResult).toHaveBeenCalledWith({ requestId: 7, saved: false, dirty: true })
        );
        expect(projectActions.discardProjectChanges).not.toHaveBeenCalled();
    });

    it('keeps a clean replacement close-blocking until its identity persistence finishes', async () => {
        projectState.identityPersistencePending = true;
        renderHook(() =>
            useNativeApplicationMenu({
                projectId: 'project',
                name: 'Song',
                createdAt: 1,
                updatedAt: 2,
                dirty: false,
                identityPersistencePending: true,
                loading: false,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        desktop.listener?.({ action: 'project:discard', requestId: 7, projectId: 'project', revision: 'revision-1' });

        await vi.waitFor(() =>
            expect(desktop.saveResult).toHaveBeenCalledWith({ requestId: 7, saved: true, dirty: true })
        );
    });

    it('keeps New and Open Recent in place when save succeeds but a concurrent edit remains dirty', async () => {
        const completeSaves: (() => void)[] = [];
        projectActions.saveProject.mockImplementation(
            () =>
                new Promise<boolean>((resolve) => {
                    completeSaves.push(() => resolve(true));
                })
        );
        renderHook(() =>
            useNativeApplicationMenu({
                projectId: 'project',
                name: 'Song',
                createdAt: 1,
                updatedAt: 2,
                dirty: false,
                loading: false,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        desktop.listener?.({ action: 'project:new' });
        desktop.listener?.({ action: 'project:open-recent', recentKey: 'recent-project' });

        await vi.waitFor(() => expect(projectActions.saveProject).toHaveBeenCalledTimes(2));
        projectState.dirty = true;
        for (const completeSave of completeSaves) {
            completeSave();
        }
        // Await both post-save continuations: this assertion fails if the
        // live dirty check is removed from the transition guard.
        await Promise.resolve();
        await Promise.resolve();
        expect(projectActions.newProject).not.toHaveBeenCalled();
        expect(projectActions.loadRecentProject).not.toHaveBeenCalled();
    });

    it('creates a new project and opens the selected recent project after a clean save', async () => {
        renderHook(() =>
            useNativeApplicationMenu({
                projectId: 'project',
                name: 'Song',
                createdAt: 1,
                updatedAt: 2,
                dirty: true,
                loading: false,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        desktop.listener?.({ action: 'project:new' });
        desktop.listener?.({ action: 'project:open-recent', recentKey: 'recent-project' });

        await vi.waitFor(() => expect(projectActions.newProject).toHaveBeenCalledTimes(1));
        expect(projectActions.loadRecentProject).toHaveBeenCalledWith('recent-project');
        expect(projectActions.saveProject).toHaveBeenCalledTimes(2);
    });

    it('routes every renderer-owned command family through its public action or use-case seam', async () => {
        renderHook(() =>
            useNativeApplicationMenu({
                projectId: 'project',
                name: 'Song',
                createdAt: 1,
                updatedAt: 2,
                dirty: false,
                loading: false,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        desktop.listener?.({ action: 'edit:select-all' });
        desktop.listener?.({ action: 'edit:deselect-all' });
        desktop.listener?.({ action: 'project:import-audio' });
        desktop.listener?.({ action: 'project:import-midi' });
        desktop.listener?.({ action: 'project:import-project' });
        desktop.listener?.({ action: 'project:export-audio' });
        desktop.listener?.({ action: 'project:export-file' });
        desktop.listener?.({ action: 'view:preferences' });
        desktop.listener?.({ action: 'view:toggle-sidebar' });
        desktop.listener?.({ action: 'view:toggle-mixer' });
        desktop.listener?.({ action: 'view:toggle-inspector' });
        desktop.listener?.({ action: 'view:toggle-track-list' });
        desktop.listener?.({ action: 'view:toggle-virtual-keyboard' });
        desktop.listener?.({ action: 'view:toggle-automation' });
        desktop.listener?.({ action: 'view:toggle-chat' });
        desktop.listener?.({ action: 'view:zoom-fit' });
        desktop.listener?.({ action: 'view:zoom-selection' });
        desktop.listener?.({ action: 'help:show-tour' });

        await vi.waitFor(() => expect(command.executeAppAction).toHaveBeenCalledWith({ type: 'importMidiFile' }));
        expect(command.executeAppAction).toHaveBeenCalledWith({ type: 'importAudioFile' });
        const supplier = arrangement.selectAllClips.mock.calls[0]?.[0];
        expect(supplier).toBeTypeOf('function');
        expect(supplier?.()).toEqual(['clip-a', 'clip-b']);
        expect(arrangement.clearClipSelection).toHaveBeenCalledTimes(1);
        expect(projectActions.pickAndImportProjectFile).toHaveBeenCalledTimes(1);
        expect(projectActions.exportProjectFile).toHaveBeenCalledTimes(1);
        expect(workspace.openExportDialog).toHaveBeenCalledTimes(1);
        expect(workspace.openPreferencesDialog).toHaveBeenCalledTimes(1);
        expect(workspace.toggleSidebar).toHaveBeenCalledTimes(1);
        expect(workspace.toggleMixer).toHaveBeenCalledTimes(1);
        expect(workspace.toggleInspector).toHaveBeenCalledTimes(1);
        expect(workspace.toggleTrackList).toHaveBeenCalledTimes(1);
        expect(workspace.toggleVirtualKeyboard).toHaveBeenCalledTimes(1);
        expect(workspace.toggleAutomationPanel).toHaveBeenCalledTimes(1);
        expect(workspace.toggleChatPanel).toHaveBeenCalledTimes(1);
        expect(workspace.zoomToFit).toHaveBeenCalledTimes(1);
        expect(workspace.zoomToSelection).toHaveBeenCalledTimes(1);
        expect(onboarding.startOnboardingTour).toHaveBeenCalledTimes(1);
    });

    it('refreshes recent projects, replaces a rerendered listener, and detaches it on unmount', () => {
        let refreshRecentProjects: (() => void) | undefined;
        projectActions.recentProjectChanges.subscribe.mockImplementation((listener: () => void) => {
            refreshRecentProjects = listener;
            return () => {
                refreshRecentProjects = undefined;
            };
        });
        projectActions.getRecentProjects.mockReturnValue([{ key: 'recent-1', name: 'First' }]);
        const { rerender, unmount } = renderHook(
            ({ updatedAt }) =>
                useNativeApplicationMenu({
                    projectId: 'project',
                    name: 'Song',
                    createdAt: 1,
                    updatedAt,
                    dirty: false,
                    loading: false,
                    keyRoot: 0,
                    scaleName: 'chromatic',
                    tuning: { name: 'Equal Temperament', frequencies: [] },
                    productionBrief: {} as never,
                    initialized: true,
                }),
            { initialProps: { updatedAt: 2 } }
        );

        rerender({ updatedAt: 3 });
        desktop.listener?.({ action: 'project:export-audio' });
        expect(workspace.openExportDialog).toHaveBeenCalledTimes(1);
        projectActions.getRecentProjects.mockReturnValue([{ key: 'recent-2', name: 'Second' }]);
        refreshRecentProjects?.();
        expect(desktop.projectState).toHaveBeenLastCalledWith({
            title: 'Song',
            dirty: false,
            durabilityPending: false,
            projectId: 'project',
            revision: 'revision-1',
            recentProjects: [{ key: 'recent-2', name: 'Second' }],
        });

        unmount();
        expect(desktop.listener).toBeUndefined();
        expect(refreshRecentProjects).toBeUndefined();
    });
});
