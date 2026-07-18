import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saveDawProjectFileDialog } from '../../repositories/saveDawProjectFileDialog';
import { writeDawProjectFile } from '../../repositories/writeDawProjectFile';
import { saveDawProjectNativeFile } from '../saveDawProjectNativeFile';

vi.mock('../../repositories/saveDawProjectFileDialog', () => ({
    saveDawProjectFileDialog: vi.fn(),
}));

vi.mock('../../repositories/writeDawProjectFile', () => ({
    writeDawProjectFile: vi.fn(),
}));

describe('saveDawProjectNativeFile', () => {
    const bytes = new Uint8Array([7, 8, 9]);

    beforeEach(() => {
        vi.mocked(saveDawProjectFileDialog).mockReset();
        vi.mocked(writeDawProjectFile).mockReset();
    });

    it('should write DAWproject bytes when the native save dialog returns a path', async () => {
        vi.mocked(saveDawProjectFileDialog).mockResolvedValue('/tmp/session.dawproject');

        await saveDawProjectNativeFile({ bytes, suggestedName: 'session.dawproject' });

        expect(saveDawProjectFileDialog).toHaveBeenCalledWith({ suggestedName: 'session.dawproject' });
        expect(writeDawProjectFile).toHaveBeenCalledWith({ filePath: '/tmp/session.dawproject', bytes });
    });

    it('should return without writing when the native save dialog is cancelled', async () => {
        vi.mocked(saveDawProjectFileDialog).mockResolvedValue(null);

        await saveDawProjectNativeFile({ bytes, suggestedName: 'session.dawproject' });

        expect(saveDawProjectFileDialog).toHaveBeenCalledWith({ suggestedName: 'session.dawproject' });
        expect(writeDawProjectFile).not.toHaveBeenCalled();
    });
});
