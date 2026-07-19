import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pickAndImportProjectFile } from '../pickAndImportProjectFile';

import type { ProjectLoadTransaction } from '../../helpers/runProjectLoadTransaction';

const transactionSentinel: ProjectLoadTransaction = {
    prepare: vi.fn(),
    activate: vi.fn(),
    canActivate: vi.fn(),
    isCurrent: vi.fn(),
};

const mocks = vi.hoisted(() => ({
    pickFiles: vi.fn<() => Promise<File[] | null>>(),
    runProjectLoadTransaction: vi.fn(),
    applyImportedProjectData: vi.fn<() => Promise<boolean>>(),
    notifyUser: vi.fn(),
    loggerError: vi.fn(),
}));

vi.mock('../../../fileDialog', () => ({
    pickFiles: mocks.pickFiles,
}));

vi.mock('../../helpers/runProjectLoadTransaction', () => ({
    runProjectLoadTransaction: mocks.runProjectLoadTransaction,
}));

vi.mock('../applyImportedProjectData', () => ({
    applyImportedProjectData: mocks.applyImportedProjectData,
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
});
