import {
    newProject,
    pendingProjectReplacements,
    pickAndImportProjectFile,
    saveProject,
    saveProjectBeforeReplacement,
} from '#/modules/Project/useCases';
import { openExportDialog, toggleBranchManager } from '#/modules/WorkspaceShell/useCases';

import { type CallableCommandEntry } from '../searchCommandRegistry';

/** Project commands — new, save, export audio, import/export files, version control. */
export const projectCommands: CallableCommandEntry[] = [
    {
        id: 'new-project',
        label: 'New Project',
        description: 'Create a new empty project',
        category: 'Project',
        action: (onCommitted?: () => void) => {
            const isStillChosen = pendingProjectReplacements.capture();
            void (async () => {
                // Same guard as the menu's New Project: a failed save, or one
                // that resolved with the project still dirty (a plugin capture
                // rejected before commit), asks whether to leave without
                // saving; Cancel keeps the project open. Choosing the open
                // project meanwhile withdraws it.
                const outgoingProject = await saveProjectBeforeReplacement();
                if (outgoingProject === 'stay' || !isStillChosen()) {
                    return;
                }
                void newProject(undefined, { outgoingProject, shouldProceed: isStillChosen }).then((created) => {
                    if (created) {
                        onCommitted?.();
                    }
                });
            })();
        },
    },
    {
        id: 'save-project',
        label: 'Save Project',
        description: 'Save project to local storage',
        category: 'Project',
        shortcut: '⌘S',
        action: (onCommitted?: () => void) => {
            void saveProject({ requestFolderSelection: true }).then((saved) => {
                if (saved) {
                    onCommitted?.();
                }
            });
        },
    },
    {
        id: 'export-audio',
        label: 'Export Audio',
        description: 'Export mixdown or stems',
        category: 'Project',
        shortcut: '⌘⇧E',
        action: (onCommitted?: () => void) => {
            openExportDialog();
            onCommitted?.();
        },
    },
    {
        id: 'export-project-file',
        label: 'Export Project File',
        description: 'Download project as .sourdaw file',
        category: 'Project',
        action: { type: 'exportProject' },
    },
    {
        id: 'import-audio',
        label: 'Import Audio',
        description: 'Import an audio file into the project',
        category: 'Project',
        action: { type: 'importAudioFile' },
    },
    {
        id: 'import-midi',
        label: 'Import MIDI File',
        description: 'Import a Standard MIDI File (.mid)',
        category: 'Project',
        action: { type: 'importMidiFile' },
    },
    {
        id: 'import-project',
        label: 'Import Project',
        description: 'Import a .sourdaw project file',
        category: 'Project',
        action: (onCommitted?: () => void) => {
            void pickAndImportProjectFile().then((imported) => {
                if (imported) {
                    onCommitted?.();
                }
            });
        },
    },
    {
        id: 'create-project-version',
        label: 'Create Project Version',
        description: 'Snapshot the current project state as a version checkpoint',
        category: 'Project',
        action: { type: 'createProjectVersion', payload: { label: 'Manual Checkpoint' } },
    },
    {
        id: 'create-version-branch',
        label: 'Create Version Branch',
        description: 'Create a new branch to experiment with an alternative direction',
        category: 'Project',
        action: { type: 'createVersionBranch', payload: { name: 'Experiment' } },
    },
    {
        id: 'open-branch-manager',
        label: 'Open Branch Manager',
        description: 'Manage project branches — switch, fork, merge, or delete',
        category: 'Project',
        action: (onCommitted?: () => void) => {
            toggleBranchManager();
            onCommitted?.();
        },
    },
    {
        id: 'export-dawproject',
        label: 'Export DAWproject',
        description: 'Export project in DAWproject format for Bitwig/Studio One interop',
        category: 'Project',
        action: { type: 'exportDawProject' },
    },
    {
        id: 'import-dawproject',
        label: 'Import DAWproject',
        description: 'Import a .dawproject file exported from Bitwig/Ableton/Studio One/Reaper/PreSonus',
        category: 'Project',
        action: { type: 'importDawProject' },
    },
];
