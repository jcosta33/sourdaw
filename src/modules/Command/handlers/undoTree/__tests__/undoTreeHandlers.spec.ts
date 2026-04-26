import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setNodeLabel } from '../../../useCases/undoTree/branchOperations/setNodeLabel';
import { toggleUndoTree } from '../../../useCases/undoTree/toggleUndoTree/toggleUndoTree';
import { handleLabelUndoBranch } from '../handleLabelUndoBranch';
import { handleToggleUndoTree } from '../handleToggleUndoTree';

vi.mock('../../../useCases/undoTree/toggleUndoTree/toggleUndoTree', () => ({ toggleUndoTree: vi.fn() }));
vi.mock('../../../useCases/undoTree/branchOperations/setNodeLabel', () => ({ setNodeLabel: vi.fn() }));

describe('Command Undo Tree Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleToggleUndoTree should delegate to toggleUndoTree', () => {
        void handleToggleUndoTree.execute({ type: 'toggleUndoTree', payload: {} });
        expect(toggleUndoTree).toHaveBeenCalled();
    });

    it('handleLabelUndoBranch should delegate to setNodeLabel', () => {
        void handleLabelUndoBranch.execute({ type: 'labelUndoBranch', payload: { nodeId: 'n1', label: 'My Label' } });
        expect(setNodeLabel).toHaveBeenCalledWith('n1', 'My Label');
    });
});
