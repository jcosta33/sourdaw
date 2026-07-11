import { describe, it, expect, beforeEach } from 'vitest';

import { dsoEditorState } from '../../../stores/dsoEditorState';
import { getRevision } from '../getRevision';

describe('getRevision', () => {
    beforeEach(() => {
        dsoEditorState.set({ revision: 0, recent_edits: [] });
    });

    it('should return the shared DSO editor revision', () => {
        dsoEditorState.set({ revision: 7, recent_edits: [] });

        expect(getRevision()).toBe(7);
    });

    it('should return zero when the shared state is cleared', () => {
        dsoEditorState.clear();

        expect(getRevision()).toBe(0);
    });
});
