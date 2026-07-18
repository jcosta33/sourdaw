import { describe, it, expect, vi, beforeEach } from 'vitest';

import { zoomToFit } from '../zoomToFit';

const { workspaceZoomToFit } = vi.hoisted(() => ({
    workspaceZoomToFit: vi.fn<typeof import('#/modules/WorkspaceShell/useCases').zoomToFit>(),
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    zoomToFit: workspaceZoomToFit,
}));

describe('zoomToFit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates to the Workspace zoomToFit use case', () => {
        workspaceZoomToFit.mockReturnValue(undefined);

        zoomToFit();

        expect(workspaceZoomToFit).toHaveBeenCalledTimes(1);
    });

    it('returns whatever the workspace implementation returns', () => {
        workspaceZoomToFit.mockReturnValue('ok' as any);

        expect(zoomToFit()).toBe('ok');
    });
});
