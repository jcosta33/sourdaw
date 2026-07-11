import { describe, it, expect, beforeEach } from 'vitest';

import { dsoEditorState } from '../../../stores/dsoEditorState';
import { logEdit } from '../logEdit';

describe('logEdit', () => {
    beforeEach(() => {
        dsoEditorState.set({ revision: 0, recent_edits: [] });
    });

    it('should append an edit to the shared recent-edit history', () => {
        logEdit('Added drums');

        expect(dsoEditorState.value?.recent_edits).toEqual(['Added drums']);
    });

    it('should retain only the five most recent edits', () => {
        for (let index = 0; index < 6; index += 1) {
            logEdit(`Edit ${index}`);
        }

        expect(dsoEditorState.value?.recent_edits).toEqual(['Edit 1', 'Edit 2', 'Edit 3', 'Edit 4', 'Edit 5']);
    });
});
