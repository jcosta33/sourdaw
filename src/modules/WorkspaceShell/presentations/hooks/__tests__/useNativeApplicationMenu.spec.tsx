import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNativeApplicationMenu } from '../useNativeApplicationMenu';

type NativeMenuIntent = Parameters<Parameters<SourdawDesktopBridge['nativeMenu']['listen']>[0]>[0];

const desktop = vi.hoisted(() => ({
    listener: undefined as ((intent: NativeMenuIntent) => void) | undefined,
    sessionListener: undefined as ((requestId: number) => void) | undefined,
    sessionCancelListener: undefined as ((requestId: number) => void) | undefined,
    projectState: vi.fn(async () => undefined),
    saveResult: vi.fn(async () => undefined),
    listenSessionQuiesce: vi.fn((listener: (requestId: number) => void) => {
        desktop.sessionListener = listener;
        return () => {
            desktop.sessionListener = undefined;
        };
    }),
    listenSessionQuiesceCancel: vi.fn((listener: (requestId: number) => void) => {
        desktop.sessionCancelListener = listener;
        return () => {
            desktop.sessionCancelListener = undefined;
        };
    }),
    sessionQuiesced: vi.fn(async () => undefined),
    sessionQuiesceStarted: vi.fn(async () => true),
}));
const projectState = vi.hoisted(() => ({
    projectId: 'project' as string | undefined,
    createdAt: 1,
    dirty: false,
    identityPersistencePending: false,
}));
const crdt = vi.hoisted(() => ({
    captureProjectRevision: vi.fn(() => 'revision-1'),
    subscribeToCrdtChanges: vi.fn(() => () => undefined),
}));
const projectActions = vi.hoisted(() => ({
    saveProject: vi.fn(async () => true),
    quiesceProjectSession: vi.fn(async () => 'success' as const),
    cancelProjectSessionQuiesce: vi.fn(async () => 'rejected' as const),
    discardProjectChanges: vi.fn(async () => true),
    newProject: vi.fn(),
    pickAndImportProjectFile: vi.fn(async () => true),
    exportProjectFile: vi.fn(async () => undefined),
    getRecentProjects: vi.fn(() => []),
    getProjectSnapshotKey: vi.fn((createdAt: number) => `sourdaw:project:${createdAt}`),
    loadRecentProject: vi.fn(async () => 'committed'),
    recentProjectChanges: { subscribe: vi.fn((_listener: () => void) => () => undefined) },
}));

vi.mock('#/modules/Project/stores', () => ({
    projectStore: {
        get value() {
            return {
                projectId: projectState.projectId,
                createdAt: projectState.createdAt,
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
    nativeApplicationMenu: vi.fn(() => ({
        listen: (listener: (intent: NativeMenuIntent) => void) => {
            desktop.listener = listener;
            return () => {
                desktop.listener = undefined;
            };
        },
        projectState: desktop.projectState,
        saveResult: desktop.saveResult,
        listenSessionQuiesce: desktop.listenSessionQuiesce,
        listenSessionQuiesceCancel: desktop.listenSessionQuiesceCancel,
        sessionQuiesced: desktop.sessionQuiesced,
        sessionQuiesceStarted: desktop.sessionQuiesceStarted,
    })),
}));
vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    ...workspace,
}));
const command = vi.hoisted(() => ({ executeAppAction: vi.fn(async () => undefined), undo: vi.fn(), redo: vi.fn() }));
vi.mock('#/modules/Command/useCases', () => command);
const commandInterface = vi.hoisted(() => ({
    dispatchCanvasEditorCommand: vi.fn(
        (target: Element | null, action: string) =>
            target instanceof HTMLElement &&
            target.closest('[data-canvas-editor]') !== null &&
            (action === 'edit:select-all' || action === 'edit:deselect-all')
    ),
}));
vi.mock('#/modules/CommandInterface/useCases', () => ({
    isNativeTextEditableTarget: (target: Element | null) =>
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable),
    dispatchCanvasEditorCommand: commandInterface.dispatchCanvasEditorCommand,
}));
const onboarding = vi.hoisted(() => ({ startOnboardingTour: vi.fn() }));
vi.mock('#/modules/Onboarding/useCases', () => onboarding);

describe('useNativeApplicationMenu', () => {
    beforeEach(() => {
        desktop.listener = undefined;
        desktop.sessionListener = undefined;
        desktop.sessionCancelListener = undefined;
        desktop.projectState.mockClear();
        desktop.saveResult.mockClear();
        desktop.listenSessionQuiesce.mockClear();
        desktop.listenSessionQuiesceCancel.mockClear();
        desktop.sessionQuiesced.mockClear();
        desktop.sessionQuiesceStarted.mockReset().mockResolvedValue(true);
        projectActions.quiesceProjectSession
            .mockReset()
            .mockImplementation(async (_requestId: number, begin?: () => Promise<boolean>) => {
                if (begin === undefined) {
                    return 'success' as const;
                }
                return (await begin()) ? ('success' as const) : ('rejected' as const);
            });
        projectState.dirty = false;
        projectState.projectId = 'project';
        projectState.createdAt = 1;
        projectState.identityPersistencePending = false;
        crdt.captureProjectRevision.mockClear();
        crdt.captureProjectRevision.mockReturnValue('revision-1');
        crdt.subscribeToCrdtChanges.mockClear();
        projectActions.saveProject.mockReset();
        projectActions.saveProject.mockResolvedValue(true);
        projectActions.discardProjectChanges.mockReset();
        projectActions.discardProjectChanges.mockResolvedValue(true);
        projectActions.pickAndImportProjectFile.mockReset();
        projectActions.pickAndImportProjectFile.mockResolvedValue(true);
        projectActions.cancelProjectSessionQuiesce.mockReset().mockResolvedValue('rejected');
        projectActions.newProject.mockClear();
        projectActions.loadRecentProject.mockClear();
        projectActions.recentProjectChanges.subscribe.mockClear();
        arrangement.zoomTimelineBy.mockClear();
        arrangement.clearClipSelection.mockClear();
        arrangement.selectAllClips.mockClear();
        command.executeAppAction.mockClear();
        command.undo.mockClear();
        command.redo.mockClear();
        commandInterface.dispatchCanvasEditorCommand.mockClear();
        onboarding.startOnboardingTour.mockClear();
        for (const action of Object.values(workspace)) {
            action.mockClear();
        }
    });

    it('acknowledges one renderer-session quiesce request with the exact result and request id', async () => {
        projectActions.quiesceProjectSession.mockImplementationOnce(
            async (_requestId: number, begin: () => Promise<boolean>) => {
                await begin();
                return 'rejected' as const;
            }
        );
        renderHook(() =>
            useNativeApplicationMenu({
                name: 'Song',
                projectId: 'project',
                createdAt: 1,
                dirty: false,
                identityPersistencePending: false,
                loading: false,
                updatedAt: 1,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        desktop.sessionListener?.(41);

        await vi.waitFor(() =>
            expect(desktop.sessionQuiesced).toHaveBeenCalledWith({ requestId: 41, outcome: 'rejected' })
        );
        expect(projectActions.quiesceProjectSession).toHaveBeenCalledTimes(1);
        expect(desktop.sessionQuiesceStarted).toHaveBeenCalledWith(41);
    });

    it('maps successful renderer retirement to the exact correlated success wire result', async () => {
        projectActions.quiesceProjectSession.mockResolvedValueOnce('success');
        renderHook(() =>
            useNativeApplicationMenu({
                name: 'Song',
                projectId: 'project',
                createdAt: 1,
                dirty: false,
                identityPersistencePending: false,
                loading: false,
                updatedAt: 1,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        desktop.sessionListener?.(44);

        await vi.waitFor(() =>
            expect(desktop.sessionQuiesced).toHaveBeenCalledWith({ requestId: 44, outcome: 'success' })
        );
    });

    it('returns a failed final quiesce reply when main rejects the destructive-start handshake', async () => {
        desktop.sessionQuiesceStarted.mockResolvedValueOnce(false);
        renderHook(() =>
            useNativeApplicationMenu({
                name: 'Song',
                projectId: 'project',
                createdAt: 1,
                dirty: false,
                identityPersistencePending: false,
                loading: false,
                updatedAt: 1,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        desktop.sessionListener?.(42);

        await vi.waitFor(() =>
            expect(desktop.sessionQuiesced).toHaveBeenCalledWith({ requestId: 42, outcome: 'rejected' })
        );
        expect(projectActions.quiesceProjectSession).toHaveBeenCalledWith(42, expect.any(Function));
    });

    it('forwards a correlated terminal result when renderer runtime repair fails', async () => {
        projectActions.quiesceProjectSession.mockResolvedValueOnce('terminal');
        renderHook(() =>
            useNativeApplicationMenu({
                name: 'Song',
                projectId: 'project',
                createdAt: 1,
                dirty: false,
                identityPersistencePending: false,
                loading: false,
                updatedAt: 1,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        desktop.sessionListener?.(43);

        await vi.waitFor(() =>
            expect(desktop.sessionQuiesced).toHaveBeenCalledWith({ requestId: 43, outcome: 'terminal' })
        );
    });

    it('routes a correlated renderer-session cancellation through the Project use case', async () => {
        renderHook(() =>
            useNativeApplicationMenu({
                name: 'Song',
                projectId: 'project',
                createdAt: 1,
                dirty: false,
                identityPersistencePending: false,
                loading: false,
                updatedAt: 1,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        desktop.sessionCancelListener?.(42);

        await vi.waitFor(() => expect(projectActions.cancelProjectSessionQuiesce).toHaveBeenCalledWith(42));
        expect(desktop.sessionQuiesced).toHaveBeenCalledWith({ requestId: 42, outcome: 'rejected' });
    });

    it('does not reopen a pending retirement on AppShell unmount', () => {
        const { unmount } = renderHook(() =>
            useNativeApplicationMenu({
                name: 'Song',
                projectId: 'project',
                createdAt: 1,
                dirty: false,
                identityPersistencePending: false,
                loading: false,
                updatedAt: 1,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
                productionBrief: {} as never,
                initialized: true,
            })
        );

        unmount();
    });

    it('republishes renderer readiness when Project hydration changes loading state', () => {
        const project = (loading: boolean) => ({
            name: 'Song',
            projectId: 'project',
            createdAt: 1,
            dirty: false,
            identityPersistencePending: false,
            loading,
            updatedAt: 1,
            keyRoot: 0,
            scaleName: 'chromatic',
            tuning: { name: 'Equal Temperament', frequencies: [] },
            productionBrief: {} as never,
            initialized: true,
        });
        const { rerender } = renderHook(({ loading }) => useNativeApplicationMenu(project(loading)), {
            initialProps: { loading: true },
        });

        rerender({ loading: false });

        expect(desktop.projectState).toHaveBeenNthCalledWith(1, expect.objectContaining({ rendererReady: false }));
        expect(desktop.projectState).toHaveBeenLastCalledWith(expect.objectContaining({ rendererReady: true }));
    });

    it('does not dispatch DAW edits while a native text field owns focus', async () => {
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
            projectKey: 'sourdaw:project:1',
            revision: 'revision-1',
            rendererReady: true,
            recentProjects: [],
        });
        const input = document.createElement('input');
        document.body.append(input);
        input.focus();
        desktop.listener?.({ action: 'edit:copy' });
        desktop.listener?.({ action: 'edit:undo' });
        desktop.listener?.({ action: 'edit:redo' });

        await Promise.resolve();
        expect(command.executeAppAction).not.toHaveBeenCalled();
        expect(command.undo).not.toHaveBeenCalled();
        expect(command.redo).not.toHaveBeenCalled();
        input.remove();
    });

    it('routes handled native selection commands to the focused canvas editor owned-command seam', async () => {
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
        const pianoRoll = document.createElement('div');
        pianoRoll.tabIndex = 0;
        pianoRoll.setAttribute('data-canvas-editor', '');
        document.body.append(pianoRoll);
        pianoRoll.focus();

        desktop.listener?.({ action: 'edit:select-all' });
        desktop.listener?.({ action: 'edit:deselect-all' });

        await Promise.resolve();
        expect(commandInterface.dispatchCanvasEditorCommand).toHaveBeenNthCalledWith(1, pianoRoll, 'edit:select-all');
        expect(commandInterface.dispatchCanvasEditorCommand).toHaveBeenNthCalledWith(2, pianoRoll, 'edit:deselect-all');
        expect(command.executeAppAction).not.toHaveBeenCalled();
        expect(arrangement.selectAllClips).not.toHaveBeenCalled();
        pianoRoll.remove();
    });

    it('falls through canvas Undo to the DAW undo stack', async () => {
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
        const pianoRoll = document.createElement('div');
        pianoRoll.tabIndex = 0;
        pianoRoll.setAttribute('data-canvas-editor', '');
        document.body.append(pianoRoll);
        pianoRoll.focus();

        desktop.listener?.({ action: 'edit:undo' });

        await Promise.resolve();
        expect(command.undo).toHaveBeenCalledOnce();
        expect(command.executeAppAction).not.toHaveBeenCalled();
        expect(commandInterface.dispatchCanvasEditorCommand).toHaveBeenNthCalledWith(1, pianoRoll, 'edit:undo');
        pianoRoll.remove();
    });

    it.each(['edit:cut', 'edit:copy', 'edit:paste'] as const)(
        'does not reinterpret unsupported canvas %s as arrangement clip editing',
        async (action) => {
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
            const pianoRoll = document.createElement('div');
            pianoRoll.tabIndex = 0;
            pianoRoll.setAttribute('data-canvas-editor', '');
            document.body.append(pianoRoll);
            pianoRoll.focus();

            desktop.listener?.({ action });

            await Promise.resolve();
            expect(commandInterface.dispatchCanvasEditorCommand).toHaveBeenCalledWith(pianoRoll, action);
            expect(command.executeAppAction).not.toHaveBeenCalled();
            pianoRoll.remove();
        }
    );

    it('keeps a legacy project close-authoritative with the same snapshot key after canonical identity migration', () => {
        projectState.projectId = undefined;
        const { rerender } = renderHook(
            ({ projectId }) =>
                useNativeApplicationMenu({
                    projectId,
                    name: 'Legacy Song',
                    createdAt: 1,
                    updatedAt: 2,
                    dirty: true,
                    loading: false,
                    keyRoot: 0,
                    scaleName: 'chromatic',
                    tuning: { name: 'Equal Temperament', frequencies: [] },
                    productionBrief: {} as never,
                    initialized: true,
                }),
            { initialProps: { projectId: undefined as string | undefined } }
        );

        expect(desktop.projectState).toHaveBeenLastCalledWith(
            expect.objectContaining({ projectKey: 'sourdaw:project:1', revision: 'revision-1' })
        );

        projectState.projectId = 'migrated-project';
        rerender({ projectId: 'migrated-project' });

        expect(desktop.projectState).toHaveBeenLastCalledWith(
            expect.objectContaining({ projectKey: 'sourdaw:project:1', revision: 'revision-1' })
        );
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

        desktop.listener?.({
            action: 'project:save',
            requestId: 8,
            projectKey: 'sourdaw:project:1',
            revision: 'revision-1',
        });

        await vi.waitFor(() =>
            expect(desktop.saveResult).toHaveBeenCalledWith({
                requestId: 8,
                saved: true,
                dirty: true,
                projectKey: 'sourdaw:project:1',
                revision: 'revision-1',
            })
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

        desktop.listener?.({
            action: 'project:save',
            requestId: 8,
            projectKey: 'sourdaw:project:1',
            revision: 'revision-1',
        });

        await vi.waitFor(() =>
            expect(desktop.saveResult).toHaveBeenCalledWith({
                requestId: 8,
                saved: false,
                dirty: true,
                projectKey: 'sourdaw:project:1',
                revision: 'revision-2',
            })
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

        desktop.listener?.({
            action: 'project:save',
            requestId: 9,
            projectKey: 'sourdaw:project:1',
            revision: 'revision-1',
        });

        await vi.waitFor(() =>
            expect(desktop.saveResult).toHaveBeenCalledWith({
                requestId: 9,
                saved: true,
                dirty: false,
                projectKey: 'sourdaw:project:1',
                revision: 'revision-1',
            })
        );
    });

    it('reports the same stable project key after a close save migrates legacy canonical identity', async () => {
        projectState.projectId = undefined;
        projectActions.saveProject.mockImplementation(async () => {
            projectState.projectId = 'migrated-project';
            crdt.captureProjectRevision.mockReturnValue('revision-2');
            return true;
        });
        renderHook(() =>
            useNativeApplicationMenu({
                projectId: undefined,
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

        desktop.listener?.({
            action: 'project:save',
            requestId: 9,
            projectKey: 'sourdaw:project:1',
            revision: 'revision-1',
        });

        await vi.waitFor(() =>
            expect(desktop.saveResult).toHaveBeenCalledWith({
                requestId: 9,
                saved: true,
                dirty: false,
                projectKey: 'sourdaw:project:1',
                revision: 'revision-2',
            })
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

        desktop.listener?.({
            action: 'project:discard',
            requestId: 7,
            projectKey: 'sourdaw:project:1',
            revision: 'revision-1',
        });

        await vi.waitFor(() => expect(projectActions.discardProjectChanges).toHaveBeenCalledTimes(1));
        expect(desktop.saveResult).toHaveBeenCalledWith({
            requestId: 7,
            saved: true,
            dirty: false,
            projectKey: 'sourdaw:project:1',
            revision: 'revision-1',
        });
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

        desktop.listener?.({
            action: 'project:discard',
            requestId: 7,
            projectKey: 'sourdaw:project:1',
            revision: 'revision-1',
        });

        await vi.waitFor(() =>
            expect(desktop.saveResult).toHaveBeenCalledWith({
                requestId: 7,
                saved: false,
                dirty: true,
                projectKey: 'sourdaw:project:1',
                revision: 'revision-2',
            })
        );
        expect(projectActions.discardProjectChanges).not.toHaveBeenCalled();
    });

    it.each([
        ['project:save', 'saveProject'],
        ['project:discard', 'discardProjectChanges'],
    ] as const)('rejects %s when a different project snapshot key is active', async (action, sideEffect) => {
        projectState.projectId = 'project-b';
        projectState.createdAt = 2;
        renderHook(() =>
            useNativeApplicationMenu({
                projectId: 'project-b',
                name: 'Song',
                createdAt: 2,
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

        desktop.listener?.({ action, requestId: 7, projectKey: 'sourdaw:project:1', revision: 'revision-1' });

        await vi.waitFor(() =>
            expect(desktop.saveResult).toHaveBeenCalledWith({
                requestId: 7,
                saved: false,
                dirty: true,
                projectKey: 'sourdaw:project:2',
                revision: 'revision-1',
            })
        );
        expect(projectActions[sideEffect]).not.toHaveBeenCalled();
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

        desktop.listener?.({
            action: 'project:discard',
            requestId: 7,
            projectKey: 'sourdaw:project:1',
            revision: 'revision-1',
        });

        await vi.waitFor(() =>
            expect(desktop.saveResult).toHaveBeenCalledWith({
                requestId: 7,
                saved: true,
                dirty: true,
                projectKey: 'sourdaw:project:1',
                revision: 'revision-1',
            })
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

        await vi.waitFor(() => expect(projectActions.saveProject).toHaveBeenCalledTimes(1));
        projectState.dirty = true;
        completeSaves[0]?.();
        await vi.waitFor(() => expect(projectActions.saveProject).toHaveBeenCalledTimes(2));
        completeSaves[1]?.();
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

    it('serializes native project transitions in menu delivery order', async () => {
        let releaseNewProject: (() => void) | undefined;
        projectActions.newProject.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    releaseNewProject = resolve;
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

        await vi.waitFor(() => expect(projectActions.newProject).toHaveBeenCalledTimes(1));
        expect(projectActions.saveProject).toHaveBeenCalledTimes(1);
        expect(projectActions.loadRecentProject).not.toHaveBeenCalled();

        releaseNewProject?.();

        await vi.waitFor(() => expect(projectActions.loadRecentProject).toHaveBeenCalledWith('recent-project'));
        expect(projectActions.saveProject).toHaveBeenCalledTimes(2);
    });

    it('preserves project transition order across hook rerenders and includes Import Project', async () => {
        const order: string[] = [];
        let releaseNewProject: (() => void) | undefined;
        projectActions.newProject.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    order.push('new:start');
                    releaseNewProject = () => {
                        order.push('new:end');
                        resolve();
                    };
                })
        );
        projectActions.pickAndImportProjectFile.mockImplementation(async () => {
            order.push('import');
            return true;
        });
        const { rerender } = renderHook(
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

        desktop.listener?.({ action: 'project:new' });
        await vi.waitFor(() => expect(projectActions.newProject).toHaveBeenCalledOnce());
        rerender({ updatedAt: 3 });
        desktop.listener?.({ action: 'project:import-project' });
        expect(projectActions.pickAndImportProjectFile).not.toHaveBeenCalled();

        releaseNewProject?.();

        await vi.waitFor(() => expect(projectActions.pickAndImportProjectFile).toHaveBeenCalledOnce());
        expect(order).toEqual(['new:start', 'new:end', 'import']);
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
            projectKey: 'sourdaw:project:1',
            revision: 'revision-1',
            rendererReady: true,
            recentProjects: [{ key: 'recent-2', name: 'Second' }],
        });

        unmount();
        expect(desktop.listener).toBeUndefined();
        expect(refreshRecentProjects).toBeUndefined();
    });
});
