import { useEffect } from 'react';

import { trackStore } from '#/modules/Arrangement/stores';
import { clearClipSelection, selectAllClips, zoomTimelineBy } from '#/modules/Arrangement/useCases';
import { executeAppAction, redo, undo } from '#/modules/Command/useCases';
import { captureProjectRevision, subscribeToCrdtChanges } from '#/modules/CrdtDocument/useCases';
import { startOnboardingTour } from '#/modules/Onboarding/useCases';
import { projectStore } from '#/modules/Project/stores';
import {
    exportProjectFile,
    discardProjectChanges,
    getRecentProjects,
    loadRecentProject,
    newProject,
    pickAndImportProjectFile,
    recentProjectChanges,
    saveProject,
} from '#/modules/Project/useCases';
import {
    openExportDialog,
    openPreferencesDialog,
    toggleInspector,
    toggleTrackList,
    toggleVirtualKeyboard,
    toggleAutomationPanel,
    toggleChatPanel,
    toggleMixer,
    toggleSidebar,
    zoomToFit,
    zoomToSelection,
    nativeApplicationMenu,
} from '#/modules/WorkspaceShell/useCases';

import type { ProjectStoreState } from '#/modules/Project/stores';

type NativeMenu = NonNullable<ReturnType<typeof nativeApplicationMenu>>;
type NativeMenuIntent = Parameters<Parameters<NativeMenu['listen']>[0]>[0];

const editableElement = (element: Element | null): boolean =>
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable);

const nativeEditOperation = (action: string): 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' | undefined => {
    switch (action) {
        case 'edit:cut':
            return 'cut';
        case 'edit:copy':
            return 'copy';
        case 'edit:paste':
            return 'paste';
        case 'edit:select-all':
            return 'selectAll';
        case 'edit:undo':
            return 'undo';
        case 'edit:redo':
            return 'redo';
        default:
            return undefined;
    }
};

const allClipIds = (): string[] =>
    trackStore.value?.tracks.flatMap((track) => track.clips.map((clip) => clip.id)) ?? [];

const saveProjectIfClean = async (): Promise<boolean> =>
    (await saveProject()) &&
    projectStore.value?.dirty !== true &&
    projectStore.value?.identityPersistencePending !== true;

/** Legacy projects gain a canonical id during persistence; until then createdAt is their stable owner key. */
const nativeProjectIdentity = (project: Pick<ProjectStoreState, 'projectId' | 'createdAt'>): string =>
    project.projectId ?? `created-at:${String(project.createdAt)}`;

const reportCloseResult = async (
    requestId: number,
    saved: boolean,
    fallbackProjectId: string,
    dirty = false
): Promise<void> => {
    const current = projectStore.value;
    await nativeApplicationMenu()?.saveResult({
        requestId,
        saved,
        dirty: dirty || current?.dirty === true || current?.identityPersistencePending === true,
        projectId: current === undefined ? fallbackProjectId : nativeProjectIdentity(current),
        revision: captureProjectRevision(),
    });
};

const runMenuAction = async (intent: NativeMenuIntent): Promise<void> => {
    const { action } = intent;
    const edit = nativeEditOperation(action);
    if (edit !== undefined && editableElement(document.activeElement)) {
        await nativeApplicationMenu()?.edit(edit);
        return;
    }
    switch (action) {
        case 'project:new':
            if (await saveProjectIfClean()) {
                await newProject();
            }
            return;
        case 'project:import-project':
            await pickAndImportProjectFile();
            return;
        case 'project:save': {
            if (
                intent.requestId !== undefined &&
                (intent.projectId === undefined ||
                    intent.revision === undefined ||
                    projectStore.value === undefined ||
                    nativeProjectIdentity(projectStore.value) !== intent.projectId ||
                    captureProjectRevision() !== intent.revision)
            ) {
                if (intent.projectId !== undefined) {
                    await reportCloseResult(intent.requestId, false, intent.projectId, true);
                }
                return;
            }
            const saved = await saveProject();
            if (intent.requestId !== undefined && intent.projectId !== undefined) {
                await reportCloseResult(intent.requestId, saved, intent.projectId);
            }
            return;
        }
        case 'project:discard': {
            if (
                intent.projectId === undefined ||
                intent.revision === undefined ||
                projectStore.value === undefined ||
                nativeProjectIdentity(projectStore.value) !== intent.projectId ||
                captureProjectRevision() !== intent.revision
            ) {
                if (intent.requestId !== undefined && intent.projectId !== undefined) {
                    await reportCloseResult(intent.requestId, false, intent.projectId, true);
                }
                return;
            }
            const discarded = await discardProjectChanges();
            if (intent.requestId !== undefined) {
                await reportCloseResult(intent.requestId, discarded, intent.projectId);
            }
            return;
        }
        case 'project:open-recent':
            if (intent.recentKey !== undefined && (await saveProjectIfClean())) {
                await loadRecentProject(intent.recentKey);
            }
            return;
        case 'project:import-audio':
            await executeAppAction({ type: 'importAudioFile' });
            return;
        case 'project:import-midi':
            await executeAppAction({ type: 'importMidiFile' });
            return;
        case 'project:export-audio':
            openExportDialog();
            return;
        case 'project:export-file':
            await exportProjectFile();
            return;
        case 'view:preferences':
            openPreferencesDialog();
            return;
        case 'view:toggle-sidebar':
            toggleSidebar();
            return;
        case 'view:toggle-mixer':
            toggleMixer();
            return;
        case 'view:toggle-inspector':
            toggleInspector();
            return;
        case 'view:toggle-track-list':
            toggleTrackList();
            return;
        case 'view:toggle-virtual-keyboard':
            toggleVirtualKeyboard();
            return;
        case 'view:toggle-automation':
            toggleAutomationPanel();
            return;
        case 'view:toggle-chat':
            toggleChatPanel();
            return;
        case 'view:zoom-fit':
            zoomToFit();
            return;
        case 'view:zoom-selection':
            zoomToSelection();
            return;
        case 'edit:undo':
            void undo();
            return;
        case 'edit:redo':
            void redo();
            return;
        case 'edit:cut':
            await executeAppAction({ type: 'cutClip' });
            return;
        case 'edit:copy':
            await executeAppAction({ type: 'copyClip' });
            return;
        case 'edit:paste':
            await executeAppAction({ type: 'pasteClip' });
            return;
        case 'edit:select-all':
            selectAllClips(allClipIds);
            return;
        case 'edit:deselect-all':
            clearClipSelection();
            return;
        case 'view:zoom-in':
            zoomTimelineBy(4);
            return;
        case 'view:zoom-out':
            zoomTimelineBy(-4);
            return;
        case 'help:show-tour':
            startOnboardingTour();
            return;
        default:
            return;
    }
};

/** Binds macOS menu intents to existing renderer-owned product operations. */
export const useNativeApplicationMenu = (project: ProjectStoreState): void => {
    useEffect(() => {
        const menu = nativeApplicationMenu();
        if (menu === undefined) {
            return undefined;
        }
        const publishProjectState = (): void => {
            void menu.projectState({
                title: project.name,
                dirty: project.dirty,
                durabilityPending: project.identityPersistencePending === true,
                projectId: nativeProjectIdentity(project),
                revision: captureProjectRevision(),
                recentProjects: getRecentProjects().map(({ key, name }) => ({ key, name })),
            });
        };
        publishProjectState();
        let transition = Promise.resolve();
        const unlisten = menu.listen((intent) => {
            if (intent.action === 'project:new' || intent.action === 'project:open-recent') {
                transition = transition.then(() => runMenuAction(intent));
                return;
            }
            void runMenuAction(intent);
        });
        const unsubscribeRecentProjects = recentProjectChanges.subscribe(publishProjectState);
        const unsubscribeCrdt = subscribeToCrdtChanges(publishProjectState);
        return () => {
            unlisten();
            unsubscribeRecentProjects();
            unsubscribeCrdt();
        };
    }, [
        project.name,
        project.projectId,
        project.createdAt,
        project.dirty,
        project.identityPersistencePending,
        project.updatedAt,
    ]);
};
