import { type CommandEntry } from '../CommandEntry';
import { eventBus } from '#/app/registerDependencies';
import { newProject, saveProject } from '#/modules/Project';

/** Project commands — new, save, export audio, import/export files, version control. */
export const projectCommands: CommandEntry[] = [
    {
        id: 'new-project',
        label: 'New Project',
        description: 'Create a new empty project',
        category: 'Project',
        action: () => {
            newProject();
        },
    },
    {
        id: 'save-project',
        label: 'Save Project',
        description: 'Save project to local storage',
        category: 'Project',
        shortcut: '⌘S',
        action: () => {
            saveProject();
        },
    },
    {
        id: 'export-audio',
        label: 'Export Audio',
        description: 'Export mixdown or stems',
        category: 'Project',
        shortcut: '⌘⇧E',
        action: () => {
            eventBus.emit('dialog.openExport', undefined);
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
        action: async () => {
            const { pickAndImportProjectFile } = await import('#/modules/Project');
            await pickAndImportProjectFile();
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
        id: 'export-dawproject',
        label: 'Export DAWproject',
        description: 'Export project in DAWproject format for Bitwig/Studio One interop',
        category: 'Project',
        action: { type: 'exportDawProject' },
    },
];
