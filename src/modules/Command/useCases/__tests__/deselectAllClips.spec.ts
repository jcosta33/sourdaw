import { describe, it, expect, vi } from 'vitest';

import { deselectAllClips } from '../deselectAllClips';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn<typeof import('#/modules/Workspace/useCases').updateWorkspaceState>(),
}));

vi.mock('#/modules/Workspace/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Workspace/useCases')>()),
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

describe('deselectAllClips', () => {
    it('clears selection in workspace state', () => {
        deselectAllClips();
        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({
            selectedClipIds: [],
            selectedClipId: null,
        });
    });
});
