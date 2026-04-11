import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setEditingTool } from '../setEditingTool';
import { getWorkspaceState, updateWorkspaceState } from '../../repositories/workspace';
import { defaultWorkspaceState } from '../../models/WorkspaceState';

describe('setEditingTool', () => {
    it('should not update when workspace state is missing', () => {
        const getState = vi.fn(() => null);
        const update = vi.fn();
        injectDependencies(setEditingTool, { getWorkspaceState: getState, updateWorkspaceState: update });

        setEditingTool('draw');

        expect(update).not.toHaveBeenCalled();
    });

    it('should patch activeTool when state exists', () => {
        const getState = vi.fn(() => ({ ...defaultWorkspaceState }));
        const update = vi.fn();
        injectDependencies(setEditingTool, { getWorkspaceState: getState, updateWorkspaceState: update });

        setEditingTool('stretch');

        expect(update).toHaveBeenCalledWith({ activeTool: 'stretch' });
    });
});
