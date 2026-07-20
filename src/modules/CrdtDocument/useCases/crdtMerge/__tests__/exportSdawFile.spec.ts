import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type DocumentBundle } from '../../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../../repositories/automergeRepository';
import { encodeSdawFile } from '../../sdawFileFormat/encodeSdawFile';
import { exportSdawFile } from '../exportSdawFile';

vi.mock('../../../repositories/automergeRepository', () => ({
    automergeRepository: {
        saveAll: vi.fn(),
    },
}));

vi.mock('../../sdawFileFormat/encodeSdawFile', () => ({
    encodeSdawFile: vi.fn(),
}));

describe('exportSdawFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('encodes the saved repository bundle and wraps it in an octet-stream blob', async () => {
        const bundle: DocumentBundle = new Map([['root', new Uint8Array([1, 2])]]);
        const encodedBytes = new Uint8Array([9, 9, 9, 9]);
        vi.mocked(automergeRepository.saveAll).mockReturnValue(bundle);
        vi.mocked(encodeSdawFile).mockReturnValue(encodedBytes);

        const blob = exportSdawFile();

        expect(automergeRepository.saveAll).toHaveBeenCalledOnce();
        expect(encodeSdawFile).toHaveBeenCalledWith(bundle);
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe('application/octet-stream');
        expect(blob.size).toBe(encodedBytes.length);
        await expect(blob.arrayBuffer()).resolves.toEqual(encodedBytes.buffer);
    });
});
