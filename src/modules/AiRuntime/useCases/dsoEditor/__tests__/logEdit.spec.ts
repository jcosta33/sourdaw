import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { dsoEditorState } from '../../../stores/dsoEditorState';
import { logEdit } from '../logEdit';

describe('logEdit', () => {
    beforeEach(() => {
        dsoEditorState.set({ revision: 0, recent_edits: [] });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should append an edit to the shared recent-edit history', () => {
        logEdit('Added drums');

        expect(dsoEditorState.value?.recent_edits).toEqual(['Added drums']);
    });

    it('should atomically append an edit without changing the revision', () => {
        dsoEditorState.set({ revision: 3, recent_edits: ['Added bass'] });
        const updateSpy = vi.spyOn(dsoEditorState, 'update');

        logEdit('Added drums');

        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(dsoEditorState.value).toEqual({ revision: 3, recent_edits: ['Added bass', 'Added drums'] });
    });

    it('should retain only the five most recent edits', () => {
        for (let index = 0; index < 6; index += 1) {
            logEdit(`Edit ${index}`);
        }

        expect(dsoEditorState.value?.recent_edits).toEqual(['Edit 1', 'Edit 2', 'Edit 3', 'Edit 4', 'Edit 5']);
    });

    it('should initialize session state when logging after a reset', () => {
        dsoEditorState.clear();

        logEdit('Added drums');

        expect(dsoEditorState.value).toEqual({ revision: 0, recent_edits: ['Added drums'] });
    });
});
