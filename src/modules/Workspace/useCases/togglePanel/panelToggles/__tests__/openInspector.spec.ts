import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

import { openInspector } from '../openInspector';

describe('openInspector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('opens the inspector', () => {
        openInspector();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ inspectorOpen: true });
    });
});
