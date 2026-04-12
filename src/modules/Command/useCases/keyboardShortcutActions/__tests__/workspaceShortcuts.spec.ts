import { describe, it, expect, vi, beforeEach } from 'vitest';
import { zoomToFit } from '../workspaceShortcuts/zoomToFit';

vi.mock('#/modules/Workspace/useCases', () => ({
    zoomToFit: vi.fn(),
}));

describe('workspaceShortcuts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('zoomToFit delegates to the injected implementation', async () => {
        const { zoomToFit: zoomToFitImpl } = await import('#/modules/Workspace/useCases');

        zoomToFit();

        expect(zoomToFitImpl).toHaveBeenCalledTimes(1);
    });
});
