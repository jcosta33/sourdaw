import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    decodeSdawFile: vi.fn(),
    detectImportDecision: vi.fn(),
    mergeDocumentBundleFromRepo: vi.fn(),
    projectCrdtToStores: vi.fn(),
    persistCrdtProject: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.warn },
}));

vi.mock('../../sdawFileFormat/decodeSdawFile', () => ({
    decodeSdawFile: mocks.decodeSdawFile,
}));

vi.mock('../detectImportDecision', () => ({
    detectImportDecision: mocks.detectImportDecision,
}));

vi.mock('../helpers', () => ({
    mergeDocumentBundleFromRepo: mocks.mergeDocumentBundleFromRepo,
}));

vi.mock('../../projection/projectProjection', () => ({
    projectCrdtToStores: mocks.projectCrdtToStores,
}));

vi.mock('../../persistCrdtProject', () => ({
    persistCrdtProject: mocks.persistCrdtProject,
}));

import { type MergeResult } from '../../../models/CrdtDocumentTypes';
import { detectImportDecision } from '../detectImportDecision';
import { importSdawFile } from '../importSdawFile';

function makeFile(): File {
    const file = new File([new Uint8Array([1, 2, 3])], 'project.sdaw');
    // jsdom File.arrayBuffer is flaky across environments — provide a deterministic one.
    file.arrayBuffer = () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer);
    return file;
}

describe('importSdawFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.decodeSdawFile.mockReturnValue(new Map());
        mocks.persistCrdtProject.mockResolvedValue(undefined);
    });

    it('should export detectImportDecision as a function', () => {
        expect(typeof detectImportDecision).toBe('function');
    });

    it('reports a merged import distinctly, carrying the merge result', async () => {
        const mergeResult: MergeResult = { mergedDocIds: ['root'], newDocIds: [] };
        mocks.detectImportDecision.mockReturnValue('merge');
        mocks.mergeDocumentBundleFromRepo.mockResolvedValue(mergeResult);

        const outcome = await importSdawFile(makeFile());

        expect(outcome).toEqual({ status: 'merged', result: mergeResult });
        expect(mocks.projectCrdtToStores).toHaveBeenCalledTimes(1);
        expect(mocks.persistCrdtProject).toHaveBeenCalledTimes(1);
    });

    it('reports the user "separate" decision distinctly from an error', async () => {
        mocks.detectImportDecision.mockReturnValue('separate');

        const outcome = await importSdawFile(makeFile());

        expect(outcome).toEqual({ status: 'separate' });
        // A "separate" decision is not a failure: no merge, no persist, no warn.
        expect(mocks.mergeDocumentBundleFromRepo).not.toHaveBeenCalled();
        expect(mocks.persistCrdtProject).not.toHaveBeenCalled();
        expect(mocks.warn).not.toHaveBeenCalled();
    });

    it('reports a decode/merge failure as an error status, not as a "separate" null', async () => {
        const failure = new Error('corrupt bundle');
        mocks.detectImportDecision.mockImplementation(() => {
            throw failure;
        });

        const outcome = await importSdawFile(makeFile());

        expect(outcome).toEqual({ status: 'error', error: failure });
        // Errors still surface through the module's logger path.
        expect(mocks.warn).toHaveBeenCalledTimes(1);
    });
});
