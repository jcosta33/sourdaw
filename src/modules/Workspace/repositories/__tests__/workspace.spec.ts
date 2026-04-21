import { describe, it, expect, vi, beforeEach } from 'vitest';

import { workspaceStore } from '../../stores/workspaceStore';
import { getWorkspaceState, updateWorkspaceState } from '../workspace';

vi.mock('../../stores/workspaceStore', () => {
    const internal = { value: { workspaceMode: 'arrangement' } };
    return {
        workspaceStore: {
            get value() {
                return internal.value;
            },
            set: vi.fn((value) => {
                internal.value = value;
            }),
        },
    };
});

describe('workspace repository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        workspaceStore.set({ workspaceMode: 'arrangement' } as any);
    });

    it('getWorkspaceState should return store value', () => {
        expect(getWorkspaceState()?.workspaceMode).toBe('arrangement');
    });

    it('updateWorkspaceState should merge patch', () => {
        updateWorkspaceState({ workspaceMode: 'mixer' });
        expect(workspaceStore.set).toHaveBeenCalledWith({ workspaceMode: 'mixer' });
        expect(getWorkspaceState()?.workspaceMode).toBe('mixer');
    });
});
