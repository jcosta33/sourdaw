import { describe, it, expect } from 'vitest';

import { handleLabelUndoBranch } from '../../handlers/undoTree/handleLabelUndoBranch';
import { handleToggleUndoTree } from '../../handlers/undoTree/handleToggleUndoTree';
import { getUndoTreeHandlers } from '../getUndoTreeHandlers';

describe('getUndoTreeHandlers', () => {
    it('merges the toggleUndoTree and labelUndoBranch handlers into a single map keyed by action type', () => {
        const handlers = getUndoTreeHandlers();

        expect(handlers).toEqual({
            toggleUndoTree: handleToggleUndoTree,
            labelUndoBranch: handleLabelUndoBranch,
        });
        expect(Object.keys(handlers)).toEqual(['toggleUndoTree', 'labelUndoBranch']);
    });
});
