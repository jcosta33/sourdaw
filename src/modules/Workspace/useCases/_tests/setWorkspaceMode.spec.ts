import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setWorkspaceMode } from '../setWorkspaceMode';
import { getWorkspaceState, updateWorkspaceState } from '../../repositories/workspace';
import { defaultWorkspaceState } from '../../models/WorkspaceState';

describe('setWorkspaceMode', () => {
    it('should not update when workspace state is missing', () => {
        const getState = vi.fn(() => null);
        const update = vi.fn();
        injectDependencies(setWorkspaceMode, { getWorkspaceState: getState, updateWorkspaceState: update });

        setWorkspaceMode('clip');

        expect(update).not.toHaveBeenCalled();
    });

    it('should patch mode when state exists', () => {
        const getState = vi.fn(() => ({ ...defaultWorkspaceState }));
        const update = vi.fn();
        injectDependencies(setWorkspaceMode, { getWorkspaceState: getState, updateWorkspaceState: update });

        setWorkspaceMode('automation');

        expect(update).toHaveBeenCalledWith({ mode: 'automation' });
    });
});
