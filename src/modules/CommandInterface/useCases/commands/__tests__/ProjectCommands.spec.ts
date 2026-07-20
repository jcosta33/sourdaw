import { beforeEach, describe, expect, it, vi } from 'vitest';

import { newProject, pickAndImportProjectFile, saveProject } from '#/modules/Project/useCases';
import { openExportDialog, toggleBranchManager } from '#/modules/WorkspaceShell/useCases';

import { projectCommands } from '../ProjectCommands';

vi.mock('#/modules/Project/useCases', () => ({
    newProject: vi.fn().mockResolvedValue(true),
    pickAndImportProjectFile: vi.fn().mockResolvedValue(true),
    saveProject: vi.fn(),
}));
vi.mock('#/modules/WorkspaceShell/useCases', () => ({ openExportDialog: vi.fn(), toggleBranchManager: vi.fn() }));

function runAction(id: string): void {
    const command = projectCommands.find((entry) => entry.id === id);
    if (!command || typeof command.action !== 'function') {
        throw new Error(`Expected a callable action for ${id}`);
    }
    command.action();
}

describe('projectCommands', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exposes the project commands under the Project category', () => {
        expect(
            projectCommands.map((entry) => ({ id: entry.id, label: entry.label, category: entry.category }))
        ).toEqual([
            { id: 'new-project', label: 'New Project', category: 'Project' },
            { id: 'save-project', label: 'Save Project', category: 'Project' },
            { id: 'export-audio', label: 'Export Audio', category: 'Project' },
            { id: 'export-project-file', label: 'Export Project File', category: 'Project' },
            { id: 'import-audio', label: 'Import Audio', category: 'Project' },
            { id: 'import-midi', label: 'Import MIDI File', category: 'Project' },
            { id: 'import-project', label: 'Import Project', category: 'Project' },
            { id: 'create-project-version', label: 'Create Project Version', category: 'Project' },
            { id: 'create-version-branch', label: 'Create Version Branch', category: 'Project' },
            { id: 'open-branch-manager', label: 'Open Branch Manager', category: 'Project' },
            { id: 'export-dawproject', label: 'Export DAWproject', category: 'Project' },
            { id: 'import-dawproject', label: 'Import DAWproject', category: 'Project' },
        ]);
    });

    it('export-project-file, import-audio, import-midi, create-project-version, create-version-branch, export-dawproject, and import-dawproject are declarative actions', () => {
        const staticEntries = [
            { id: 'export-project-file', action: { type: 'exportProject' } },
            { id: 'import-audio', action: { type: 'importAudioFile' } },
            { id: 'import-midi', action: { type: 'importMidiFile' } },
            {
                id: 'create-project-version',
                action: { type: 'createProjectVersion', payload: { label: 'Manual Checkpoint' } },
            },
            {
                id: 'create-version-branch',
                action: { type: 'createVersionBranch', payload: { name: 'Experiment' } },
            },
            { id: 'export-dawproject', action: { type: 'exportDawProject' } },
            { id: 'import-dawproject', action: { type: 'importDawProject' } },
        ];

        for (const { id, action } of staticEntries) {
            const command = projectCommands.find((entry) => entry.id === id);
            expect(command?.action).toEqual(action);
        }
    });

    it('new-project creates a new empty project', () => {
        runAction('new-project');

        expect(newProject).toHaveBeenCalledTimes(1);
    });

    it('save-project saves the project to local storage', () => {
        runAction('save-project');

        expect(saveProject).toHaveBeenCalledTimes(1);
    });

    it('export-audio opens the export dialog', () => {
        runAction('export-audio');

        expect(openExportDialog).toHaveBeenCalledTimes(1);
    });

    it('open-branch-manager toggles the branch manager dialog', () => {
        runAction('open-branch-manager');

        expect(toggleBranchManager).toHaveBeenCalledTimes(1);
    });

    it('import-project opens the project file picker', () => {
        runAction('import-project');

        expect(pickAndImportProjectFile).toHaveBeenCalledTimes(1);
    });
});
