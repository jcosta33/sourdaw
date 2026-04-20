import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { downloadBlob } from '../downloadFile';

describe('downloadFile repository', () => {
    beforeEach(() => {
        global.URL.createObjectURL = vi.fn(() => 'blob:url');
        global.URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should create a blob and trigger download via a temporary link', () => {
        const mockAnchor = {
            click: vi.fn(),
            href: '',
            download: '',
        };
        const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);

        downloadBlob('some data', 'test.mid', 'audio/midi');

        expect(createElementSpy).toHaveBeenCalledWith('a');
        expect(mockAnchor.href).toBe('blob:url');
        expect(mockAnchor.download).toBe('test.mid');
        expect(mockAnchor.click).toHaveBeenCalled();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:url');
    });
});
