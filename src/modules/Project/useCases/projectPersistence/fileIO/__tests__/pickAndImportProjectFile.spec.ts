import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectLoadFailureStore } from '../../../../stores/projectLoadFailureStore';
import { pickAndImportProjectFile } from '../pickAndImportProjectFile';

import type { ProjectLoadTransaction } from '../../helpers/runProjectLoadTransaction';

const transactionSentinel: ProjectLoadTransaction = {
    prepare: vi.fn(),
    activate: vi.fn(),
    canActivate: vi.fn(),
    isCurrent: vi.fn(),
};

const mocks = vi.hoisted(() => {
    const projectStoreValue: { value: { name: string; createdAt: number; dirty: boolean } | null } = {
        value: null,
    };
    return {
        pickFiles: vi.fn<() => Promise<File[] | null>>(),
        runProjectLoadTransaction: vi.fn<() => ProjectLoadTransaction>(),
        applyImportedProjectData: vi.fn<() => Promise<boolean>>(),
        notifyUser: vi.fn<(message: string, level?: 'info' | 'success' | 'warning' | 'error') => void>(),
        loggerError: vi.fn<(error: Error) => void>(),
        saveProject: vi.fn<() => Promise<boolean>>(),
        projectStoreValue,
    };
});

vi.mock('../../../fileDialog', () => ({
    pickFiles: mocks.pickFiles,
}));

vi.mock('../../helpers/runProjectLoadTransaction', () => ({
    runProjectLoadTransaction: mocks.runProjectLoadTransaction,
}));

vi.mock('../applyImportedProjectData', () => ({
    applyImportedProjectData: mocks.applyImportedProjectData,
}));

vi.mock('../../saveProject/saveProject', () => ({
    saveProject: mocks.saveProject,
}));

vi.mock('../../../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return mocks.projectStoreValue.value;
        },
    },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        error: mocks.loggerError,
    },
}));

function makeFile(content: string, name = 'song.sourdaw'): File {
    return new File([content], name);
}

describe('pickAndImportProjectFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.runProjectLoadTransaction.mockReturnValue(transactionSentinel);
        mocks.saveProject.mockResolvedValue(true);
        mocks.projectStoreValue.value = null;
        projectLoadFailureStore.set(null);
    });

    it('returns false without starting a transaction when no file is selected', async () => {
        mocks.pickFiles.mockResolvedValue(null);

        await expect(pickAndImportProjectFile()).resolves.toBe(false);

        expect(mocks.pickFiles).toHaveBeenCalledWith({
            multiple: false,
            filters: [{ name: 'Sourdaw Project', extensions: ['sourdaw'] }],
        });
        expect(mocks.runProjectLoadTransaction).not.toHaveBeenCalled();
        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('returns false when the picker resolves an empty selection', async () => {
        mocks.pickFiles.mockResolvedValue([]);

        await expect(pickAndImportProjectFile()).resolves.toBe(false);

        expect(mocks.runProjectLoadTransaction).not.toHaveBeenCalled();
        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
    });

    it('parses the selected file and delegates the decoded data to applyImportedProjectData', async () => {
        const projectJson = { version: 1, meta: { name: 'My Song' } };
        mocks.pickFiles.mockResolvedValue([makeFile(JSON.stringify(projectJson))]);
        mocks.applyImportedProjectData.mockResolvedValue(true);

        await expect(pickAndImportProjectFile()).resolves.toBe(true);

        expect(mocks.runProjectLoadTransaction).toHaveBeenCalledTimes(1);
        expect(mocks.applyImportedProjectData).toHaveBeenCalledWith({
            data: projectJson,
            transaction: transactionSentinel,
        });
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('notifies the user and returns false when the decoded data is rejected as unhydratable', async () => {
        mocks.pickFiles.mockResolvedValue([makeFile('{"version":1}')]);
        mocks.applyImportedProjectData.mockResolvedValue(false);

        await expect(pickAndImportProjectFile()).resolves.toBe(false);

        expect(mocks.notifyUser).toHaveBeenCalledWith('Invalid project file format', 'error');
        expect(mocks.loggerError).not.toHaveBeenCalled();
    });

    /**
     * `applyImportedProjectData` returns false for "unusable file", for
     * "superseded", and for "the open destroyed the session and then failed".
     * Only the first is the file's fault. Telling the user their file is
     * malformed after the third sends them back to the picker to try again
     * while their session is already gone, and buries the real message.
     */
    it('does not blame the file when the open destroyed the session', async () => {
        mocks.pickFiles.mockResolvedValue([makeFile(JSON.stringify({ version: 1 }))]);
        mocks.applyImportedProjectData.mockResolvedValue(false);
        projectLoadFailureStore.set({ message: 'session gone', projectName: 'Half Finished Song' });

        await expect(pickAndImportProjectFile()).resolves.toBe(false);

        expect(mocks.notifyUser).not.toHaveBeenCalledWith('Invalid project file format', 'error');
    });

    it('notifies, logs, and returns false when the file contents are not valid JSON', async () => {
        mocks.pickFiles.mockResolvedValue([makeFile('not-json{{{')]);

        await expect(pickAndImportProjectFile()).resolves.toBe(false);

        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith('Failed to read project file', 'error');
        expect(mocks.loggerError).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Import error', cause: expect.any(SyntaxError) })
        );
    });

    it('notifies and logs when reading the file text rejects', async () => {
        const file = makeFile('irrelevant');
        const readFailure = new Error('disk read failed');
        vi.spyOn(file, 'text').mockRejectedValue(readFailure);
        mocks.pickFiles.mockResolvedValue([file]);

        await expect(pickAndImportProjectFile()).resolves.toBe(false);

        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith('Failed to read project file', 'error');
        expect(mocks.loggerError).toHaveBeenCalledWith(expect.objectContaining({ cause: readFailure }));
    });

    it('pre-saves a dirty open project before replacing it with the import', async () => {
        const projectJson = { version: 1, meta: { name: 'Imported Song' } };
        mocks.pickFiles.mockResolvedValue([makeFile(JSON.stringify(projectJson))]);
        mocks.applyImportedProjectData.mockResolvedValue(true);
        mocks.projectStoreValue.value = { name: 'Open Song', createdAt: 1, dirty: true };

        let resolveSave: ((value: boolean) => void) | undefined;
        mocks.saveProject.mockImplementation(
            () =>
                new Promise<boolean>((resolve) => {
                    resolveSave = resolve;
                })
        );

        const importOperation = pickAndImportProjectFile();
        await vi.waitFor(() => expect(mocks.saveProject).toHaveBeenCalledOnce());
        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();

        resolveSave?.(true);
        await expect(importOperation).resolves.toBe(true);
        expect(mocks.applyImportedProjectData).toHaveBeenCalledOnce();
    });

    it('aborts the import when the pre-save of the dirty open project fails', async () => {
        const projectJson = { version: 1, meta: { name: 'Imported Song' } };
        mocks.pickFiles.mockResolvedValue([makeFile(JSON.stringify(projectJson))]);
        mocks.projectStoreValue.value = { name: 'Open Song', createdAt: 1, dirty: true };
        mocks.saveProject.mockResolvedValue(false);

        await expect(pickAndImportProjectFile()).resolves.toBe(false);

        expect(mocks.saveProject).toHaveBeenCalledOnce();
        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
        expect(mocks.runProjectLoadTransaction).not.toHaveBeenCalled();
    });

    it('does not pre-save when the open project has no unsaved changes', async () => {
        const projectJson = { version: 1, meta: { name: 'Imported Song' } };
        mocks.pickFiles.mockResolvedValue([makeFile(JSON.stringify(projectJson))]);
        mocks.applyImportedProjectData.mockResolvedValue(true);
        mocks.projectStoreValue.value = { name: 'Open Song', createdAt: 1, dirty: false };

        await expect(pickAndImportProjectFile()).resolves.toBe(true);

        expect(mocks.saveProject).not.toHaveBeenCalled();
    });
});
