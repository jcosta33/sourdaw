import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    saveEditedProjectBeforeReplacement: vi.fn(() => Promise.resolve(true)),
    runProjectLoadTransaction: vi.fn(),
    parseDawProject: vi.fn(),
    decodeDawProjectAssets: vi.fn(),
    mapToProjectData: vi.fn(),
    applyImportedProjectData: vi.fn(),
    notifyUser: vi.fn(),
    logger: { warn: vi.fn() },
}));

vi.mock('#/modules/Project/useCases', () => ({
    runProjectLoadTransaction: mocks.runProjectLoadTransaction,
    applyImportedProjectData: mocks.applyImportedProjectData,
    saveEditedProjectBeforeReplacement: mocks.saveEditedProjectBeforeReplacement,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
}));

vi.mock('../decodeDawProjectAssets', () => ({
    decodeDawProjectAssets: mocks.decodeDawProjectAssets,
}));

vi.mock('../mapToProjectData', () => ({
    mapToProjectData: mocks.mapToProjectData,
}));

vi.mock('../parseDawProject', () => ({
    parseDawProject: mocks.parseDawProject,
}));

import { importDawProject } from '../importDawProject';

const mockTransaction = { canActivate: () => true };

function setupHappyPath() {
    mocks.runProjectLoadTransaction.mockReturnValue(mockTransaction);
    mocks.parseDawProject.mockReturnValue({
        meta: { title: 'My Song' },
        audioAssets: [],
    });
    mocks.decodeDawProjectAssets.mockResolvedValue({
        audioBuffers: [],
        bufferIdsByPath: {},
        failedPaths: [],
    });
    mocks.mapToProjectData.mockReturnValue({
        arrangement: { tracks: [{ id: 't1' }, { id: 't2' }] },
    });
    mocks.applyImportedProjectData.mockResolvedValue(true);
}

describe('importDawProject', () => {
    it('returns false and notifies on parse error', async () => {
        mocks.runProjectLoadTransaction.mockReturnValue(mockTransaction);
        mocks.parseDawProject.mockImplementation(() => {
            throw new Error('bad xml');
        });

        const result = await importDawProject({ buffer: new ArrayBuffer(8), fileName: 'test.dawproject' });

        expect(result).toBe(false);
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('bad xml'), 'error');
        expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
    });

    it('returns false when transaction is cancelled after decode', async () => {
        const cancelledTransaction = { canActivate: () => false };
        mocks.runProjectLoadTransaction.mockReturnValue(cancelledTransaction);
        mocks.parseDawProject.mockReturnValue({ meta: { title: '' }, audioAssets: [] });
        mocks.decodeDawProjectAssets.mockResolvedValue({ audioBuffers: [], bufferIdsByPath: {}, failedPaths: [] });

        const result = await importDawProject({ buffer: new ArrayBuffer(8), fileName: 'test.dawproject' });

        expect(result).toBe(false);
        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
    });

    it('returns true and notifies success on happy path', async () => {
        setupHappyPath();
        vi.clearAllMocks();
        setupHappyPath();

        const result = await importDawProject({ buffer: new ArrayBuffer(8), fileName: 'test.dawproject' });

        expect(result).toBe(true);
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('My Song'), 'success');
        expect(mocks.notifyUser.mock.calls[0]?.[0]).toContain('2 tracks');
    });

    // A user's Stop lands its take in the open project after the picker's
    // pre-save ran, while the file is parsed and its audio decoded. The import is
    // about to replace that project, so the take is saved after the read and
    // before the replacement.
    it('saves the open project after the file is read and before it is replaced', async () => {
        vi.clearAllMocks();
        setupHappyPath();
        mocks.saveEditedProjectBeforeReplacement.mockResolvedValue(true);

        await expect(importDawProject({ buffer: new ArrayBuffer(8), fileName: 'test.dawproject' })).resolves.toBe(true);

        expect(mocks.saveEditedProjectBeforeReplacement).toHaveBeenCalledOnce();
        const [decoded = 0] = mocks.decodeDawProjectAssets.mock.invocationCallOrder;
        const [saved = 0] = mocks.saveEditedProjectBeforeReplacement.mock.invocationCallOrder;
        const [applied = 0] = mocks.applyImportedProjectData.mock.invocationCallOrder;
        expect(decoded).toBeLessThan(saved);
        expect(saved).toBeLessThan(applied);
    });

    it('keeps the open project when that save refuses the replacement', async () => {
        vi.clearAllMocks();
        setupHappyPath();
        mocks.saveEditedProjectBeforeReplacement.mockResolvedValueOnce(false);

        await expect(importDawProject({ buffer: new ArrayBuffer(8), fileName: 'test.dawproject' })).resolves.toBe(
            false
        );

        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
    });

    it('notifies with fileName when title is empty', async () => {
        vi.clearAllMocks();
        mocks.runProjectLoadTransaction.mockReturnValue(mockTransaction);
        mocks.parseDawProject.mockReturnValue({ meta: { title: '' }, audioAssets: [] });
        mocks.decodeDawProjectAssets.mockResolvedValue({ audioBuffers: [], bufferIdsByPath: {}, failedPaths: [] });
        mocks.mapToProjectData.mockReturnValue({ arrangement: { tracks: [{ id: 't1' }] } });
        mocks.applyImportedProjectData.mockResolvedValue(true);

        await importDawProject({ buffer: new ArrayBuffer(8), fileName: 'myfile.dawproject' });

        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('myfile.dawproject'), 'success');
    });

    it('returns false and notifies on apply error', async () => {
        vi.clearAllMocks();
        mocks.runProjectLoadTransaction.mockReturnValue(mockTransaction);
        mocks.parseDawProject.mockReturnValue({ meta: { title: '' }, audioAssets: [] });
        mocks.decodeDawProjectAssets.mockResolvedValue({ audioBuffers: [], bufferIdsByPath: {}, failedPaths: [] });
        mocks.mapToProjectData.mockReturnValue({ arrangement: { tracks: [] } });
        mocks.applyImportedProjectData.mockRejectedValue(new Error('apply failed'));

        const result = await importDawProject({ buffer: new ArrayBuffer(8), fileName: 'test.dawproject' });

        expect(result).toBe(false);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Failed to apply imported DAWproject data', 'error');
    });

    it('does not notify success when apply returns false', async () => {
        vi.clearAllMocks();
        mocks.runProjectLoadTransaction.mockReturnValue(mockTransaction);
        mocks.parseDawProject.mockReturnValue({ meta: { title: 'X' }, audioAssets: [] });
        mocks.decodeDawProjectAssets.mockResolvedValue({ audioBuffers: [], bufferIdsByPath: {}, failedPaths: [] });
        mocks.mapToProjectData.mockReturnValue({ arrangement: { tracks: [{ id: 't1' }] } });
        mocks.applyImportedProjectData.mockResolvedValue(false);

        const result = await importDawProject({ buffer: new ArrayBuffer(8), fileName: 'test.dawproject' });

        expect(result).toBe(false);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });
});
