import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    newProject,
    pendingProjectReplacements,
    pickAndImportProjectFile,
    saveProject,
    saveProjectBeforeReplacement,
} from '#/modules/Project/useCases';
import { openExportDialog, toggleBranchManager } from '#/modules/WorkspaceShell/useCases';

import { projectCommands } from '../ProjectCommands';

const withdrawals = vi.hoisted(() => ({ count: 0 }));

// The registry's contract, kept behind plain functions: a withdrawal turns
// false every check captured before it. Importing the real module would cross
// the Project barrel, which loads half the app.
vi.mock('#/modules/Project/useCases', () => ({
    pendingProjectReplacements: {
        capture: () => {
            const captured = withdrawals.count;
            return () => withdrawals.count === captured;
        },
        withdraw: () => {
            withdrawals.count += 1;
        },
    },
    newProject: vi.fn().mockResolvedValue(true),
    pickAndImportProjectFile: vi.fn().mockResolvedValue(true),
    saveProject: vi.fn(),
    saveProjectBeforeReplacement: vi.fn(),
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
        vi.mocked(saveProjectBeforeReplacement).mockResolvedValue(true);
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

    it('new-project runs the pre-switch guard, then creates a new empty project', async () => {
        runAction('new-project');

        await vi.waitFor(() => expect(saveProjectBeforeReplacement).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(newProject).toHaveBeenCalledTimes(1));
    });

    // Choosing the open project's Recent entry while New is pending withdraws
    // it, so the session stays in the project the user chose last.
    it('new-project does not start once a pre-save that the open project choice outlasted finishes', async () => {
        const save = Promise.withResolvers<boolean>();
        vi.mocked(saveProjectBeforeReplacement).mockReturnValueOnce(save.promise);

        runAction('new-project');
        await vi.waitFor(() => expect(saveProjectBeforeReplacement).toHaveBeenCalledTimes(1));
        pendingProjectReplacements.withdraw();
        save.resolve(true);

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(newProject).not.toHaveBeenCalled();
    });

    it('new-project hands the replacement a check that the open project choice turns false', async () => {
        runAction('new-project');
        await vi.waitFor(() => expect(newProject).toHaveBeenCalledTimes(1));

        const shouldProceed = vi.mocked(newProject).mock.calls[0]?.[1]?.shouldProceed;
        expect(shouldProceed?.()).toBe(true);
        pendingProjectReplacements.withdraw();
        expect(shouldProceed?.()).toBe(false);
    });

    // Issue 3694: the palette replaces the open project, so it must refuse
    // when the guard refuses — a save that resolved with the project still
    // dirty (a plugin capture rejected before commit) must not be replaced
    // over. Removing the guard call from the action reds this test.
    it('new-project refuses the replacement when the pre-switch guard refuses', async () => {
        vi.mocked(saveProjectBeforeReplacement).mockResolvedValue(false);

        runAction('new-project');

        await vi.waitFor(() => expect(saveProjectBeforeReplacement).toHaveBeenCalledTimes(1));
        await Promise.resolve();
        await Promise.resolve();
        expect(newProject).not.toHaveBeenCalled();
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
