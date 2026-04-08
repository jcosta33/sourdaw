import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeMoveClip } from './clipHandlers';

describe('clipHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeMoveClip forwards to moveClip', () => {
        const moveClip = vi.fn();
        injectDependencies(executeMoveClip, { moveClip });

        executeMoveClip({
            type: 'moveClip',
            payload: { clipId: 'c1', trackId: 't1', startBeat: 4 },
        });

        expect(moveClip).toHaveBeenCalledWith('c1', 't1', 4);
    });
});
