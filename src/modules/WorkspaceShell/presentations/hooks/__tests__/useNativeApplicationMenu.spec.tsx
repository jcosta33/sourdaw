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
const projectState = vi.hoisted(() => ({ dirty: false }));
const projectActions = vi.hoisted(() => ({
    saveProject: vi.fn(async () => true),
    newProject: vi.fn(),
    pickAndImportProjectFile: vi.fn(async () => true),
    exportProjectFile: vi.fn(async () => undefined),
    getRecentProjects: vi.fn(() => []),
    loadRecentProject: vi.fn(async () => 'committed'),
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
            return { dirty: projectState.dirty };
        },
    },
}));
vi.mock('#/modules/Project/useCases', () => projectActions);
const arrangement = vi.hoisted(() => ({
    clearClipSelection: vi.fn(),
    selectAllClips: vi.fn(),
    zoomTimelineBy: vi.fn(),
}));
vi.mock('#/modules/Arrangement/useCases', () => arrangement);
vi.mock('#/modules/WorkspaceShell/useCases', () => ({
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
const command = vi.hoisted(() => ({ executeAppAction: vi.fn(async () => undefined), undo: vi.fn(), redo: vi.fn() }));
vi.mock('#/modules/Command/useCases', () => command);

describe('useNativeApplicationMenu', () => {
    beforeEach(() => {
        desktop.listener = undefined;
        desktop.projectState.mockClear();
        desktop.saveResult.mockClear();
        desktop.edit.mockClear();
        projectState.dirty = false;
        projectActions.saveProject.mockClear();
        projectActions.newProject.mockClear();
        projectActions.loadRecentProject.mockClear();
        arrangement.zoomTimelineBy.mockClear();
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

    it('keeps New and Open Recent in place when save succeeds but a concurrent edit remains dirty', async () => {
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

        desktop.listener?.({ action: 'project:new' });
        desktop.listener?.({ action: 'project:open-recent', recentKey: 'recent-project' });

        await vi.waitFor(() => expect(projectActions.saveProject).toHaveBeenCalledTimes(2));
        expect(projectActions.newProject).not.toHaveBeenCalled();
        expect(projectActions.loadRecentProject).not.toHaveBeenCalled();
    });
});
