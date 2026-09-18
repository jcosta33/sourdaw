import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopSaveDialog, writeFileBytes } from '#/utils/desktopBridge';

import { saveDawProjectFileDialog } from '../saveDawProjectFileDialog';
import { writeDawProjectFile } from '../writeDawProjectFile';

vi.mock('#/utils/desktopBridge', () => ({
    desktopSaveDialog: vi.fn(),
    writeFileBytes: vi.fn(),
}));

describe('DAWproject native repositories', () => {
    beforeEach(() => {
        vi.mocked(desktopSaveDialog).mockReset();
        vi.mocked(writeFileBytes).mockReset();
    });

    it('should request a DAWproject save path with the suggested file name', async () => {
        vi.mocked(desktopSaveDialog).mockResolvedValue('/tmp/session.dawproject');

        const result = await saveDawProjectFileDialog({ suggestedName: 'session.dawproject' });

        expect(result).toBe('/tmp/session.dawproject');
        expect(desktopSaveDialog).toHaveBeenCalledWith({
            defaultPath: 'session.dawproject',
            filters: [{ name: 'DAWproject', extensions: ['dawproject'] }],
        });
    });

    it('should return null when the native save dialog is cancelled', async () => {
        vi.mocked(desktopSaveDialog).mockResolvedValue(null);

        const result = await saveDawProjectFileDialog({ suggestedName: 'session.dawproject' });

        expect(result).toBeNull();
    });

    it('should forward DAWproject bytes to the native filesystem writer', async () => {
        const bytes = new Uint8Array([1, 2, 3]);

        await writeDawProjectFile({ filePath: '/tmp/session.dawproject', bytes });

        expect(writeFileBytes).toHaveBeenCalledWith({ path: '/tmp/session.dawproject', bytes });
    });
});
