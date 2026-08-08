import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
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
