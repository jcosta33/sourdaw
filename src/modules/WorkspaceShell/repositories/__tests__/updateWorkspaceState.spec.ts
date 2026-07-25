import { describe, it, expect, vi, beforeEach } from 'vitest';

import { workspaceStore } from '../../stores/workspaceStore';
import { getWorkspaceState } from '../getWorkspaceState';
import { updateWorkspaceState } from '../updateWorkspaceState';

import type { WorkspaceState } from '../../models/WorkspaceState';

vi.mock('../../stores/workspaceStore', () => {
    const internal: { value: Partial<WorkspaceState> | null } = { value: { mode: 'arrange' } };
    return {
        workspaceStore: {
            get value() {
                return internal.value;
            },
            set: vi.fn((value: WorkspaceState | null) => {
                internal.value = value;
            }),
        },
    };
});

describe('updateWorkspaceState repository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        workspaceStore.set({ mode: 'arrange' } as WorkspaceState);
    });

    it('updateWorkspaceState should merge patch', () => {
        updateWorkspaceState({ mode: 'automation' });
        expect(workspaceStore.set).toHaveBeenCalledWith({ mode: 'automation' });
        expect(getWorkspaceState()?.mode).toBe('automation');
    });

    it('throws when the store is not initialized (null is an invariant violation)', () => {
        workspaceStore.set(null);
        // The guard is load-bearing: a null store must surface loudly, not silently swallow.
        expect(() => updateWorkspaceState({ mode: 'arrange' })).toThrowError(/not initialized/);
    });
});
