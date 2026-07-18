import { describe, it, expect, vi, beforeEach } from 'vitest';

import { workspaceStore } from '../../stores/workspaceStore';
import { getWorkspaceState } from '../getWorkspaceState';

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

describe('getWorkspaceState repository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        workspaceStore.set({ mode: 'arrange' } as WorkspaceState);
    });

    it('getWorkspaceState should return store value', () => {
        expect(getWorkspaceState()?.mode).toBe('arrange');
    });
});
