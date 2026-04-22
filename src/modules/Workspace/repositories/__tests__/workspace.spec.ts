import { describe, it, expect, vi, beforeEach } from 'vitest';

import { workspaceStore } from '../../stores/workspaceStore';
import { getWorkspaceState, updateWorkspaceState } from '../workspace';

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

describe('workspace repository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        workspaceStore.set({ mode: 'arrange' } as WorkspaceState);
    });

    it('getWorkspaceState should return store value', () => {
        expect(getWorkspaceState()?.mode).toBe('arrange');
    });

    it('updateWorkspaceState should merge patch', () => {
        updateWorkspaceState({ mode: 'automation' });
        expect(workspaceStore.set).toHaveBeenCalledWith({ mode: 'automation' });
        expect(getWorkspaceState()?.mode).toBe('automation');
    });
});
