import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { commitTrackOutput } from '../commitTrackOutput';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('commitTrackOutput', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('dispatches the pick as a setTrackOutput action guarded by the output the caller saw', async () => {
        mocks.executeAppAction.mockResolvedValue(undefined);

        await commitTrackOutput({ trackId: 'kick', outputId: 'drums', expectedOutputId: 'master' });

        expect(mocks.executeAppAction).toHaveBeenCalledExactlyOnceWith({
            type: 'setTrackOutput',
            payload: { trackId: 'kick', outputId: 'drums', expectedOutputId: 'master' },
        });
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('reports a failed commit with its cause instead of rejecting', async () => {
        const failure = new Error('document unavailable');
        mocks.executeAppAction.mockRejectedValue(failure);

        await expect(
            commitTrackOutput({ trackId: 'kick', outputId: 'drums', expectedOutputId: 'master' })
        ).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ message: 'Track output commit failed for kick -> drums', cause: failure })
        );
    });
});
