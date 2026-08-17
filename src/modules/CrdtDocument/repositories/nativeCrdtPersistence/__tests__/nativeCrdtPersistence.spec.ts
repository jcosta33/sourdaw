import { describe, it, expect, vi, beforeEach } from 'vitest';

import { invokeCommand } from '../invokeCommand';
import { nativeApplyChange } from '../nativeApplyChange';
import { nativeCreateProject } from '../nativeCreateProject';
import { nativeGetDocumentState } from '../nativeGetDocumentState';
import { nativeLoadBundle } from '../nativeLoadBundle';
import { nativeMergeBundle } from '../nativeMergeBundle';
import { nativeSaveBundle } from '../nativeSaveBundle';

vi.mock('../invokeCommand', () => ({
    invokeCommand: vi.fn(),
}));

describe('nativeCrdtPersistence repository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('nativeApplyChange should call tauri invoke', async () => {
        vi.mocked(invokeCommand).mockResolvedValue(true);
        const result = await nativeApplyChange('doc1', new Uint8Array([1, 2, 3]));
        expect(invokeCommand).toHaveBeenCalledWith('collab_apply_change', { docId: 'doc1', changeBytes: [1, 2, 3] });
        expect(result).toBe(true);
    });

    it('nativeCreateProject should call tauri invoke', async () => {
        vi.mocked(invokeCommand).mockResolvedValue(true);
        const result = await nativeCreateProject('My Project', 48000);
        expect(invokeCommand).toHaveBeenCalledWith('collab_create_project', { name: 'My Project', sampleRate: 48000 });
        expect(result).toBe(true);
    });

    it('nativeGetDocumentState should call tauri invoke', async () => {
        vi.mocked(invokeCommand).mockResolvedValue({ some: 'data' });
        const result = await nativeGetDocumentState('doc1');
        expect(invokeCommand).toHaveBeenCalledWith('collab_get_document_state', { docId: 'doc1' });
        expect(result).toEqual({ some: 'data' });
    });

    it('nativeGetDocumentState should return null if no result', async () => {
        vi.mocked(invokeCommand).mockResolvedValue(null);
        const result = await nativeGetDocumentState('doc1');
        expect(result).toBeNull();
    });

    it('nativeLoadBundle should call tauri invoke and map to DocumentBundle', async () => {
        vi.mocked(invokeCommand).mockResolvedValue({
            doc1: [1, 2],
            doc2: [3, 4],
        });
        const bundle = await nativeLoadBundle('/path/test.sdaw');
        expect(invokeCommand).toHaveBeenCalledWith('collab_load_bundle', { path: '/path/test.sdaw' });
        expect(bundle?.get('doc1')).toEqual(new Uint8Array([1, 2]));
        expect(bundle?.get('doc2')).toEqual(new Uint8Array([3, 4]));
    });

    it('nativeLoadBundle should return null if no result', async () => {
        vi.mocked(invokeCommand).mockResolvedValue(null);
        const bundle = await nativeLoadBundle('/path/test.sdaw');
        expect(bundle).toBeNull();
    });

    it('nativeMergeBundle should call tauri invoke', async () => {
        const mockResult = { mergedDocIds: ['doc1'], newDocIds: ['doc2'] };
        vi.mocked(invokeCommand).mockResolvedValue(mockResult);
        const bundle = await nativeMergeBundle('/path/test.sdaw');
        expect(invokeCommand).toHaveBeenCalledWith('collab_merge_bundle', { path: '/path/test.sdaw' });
        expect(bundle).toEqual(mockResult);
    });

    it('nativeSaveBundle should call tauri invoke', async () => {
        vi.mocked(invokeCommand).mockResolvedValue(true);
        const result = await nativeSaveBundle('/path/test.sdaw');
        expect(invokeCommand).toHaveBeenCalledWith('collab_save_bundle', { path: '/path/test.sdaw' });
        expect(result).toBe(true);
    });
});
