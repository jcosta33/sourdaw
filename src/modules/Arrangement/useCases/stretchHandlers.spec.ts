import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeSetClipStretchMode } from './stretchHandlers';

describe('stretchHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeSetClipStretchMode forwards clip id and mode', () => {
        const setClipStretchMode = vi.fn();
        injectDependencies(executeSetClipStretchMode, { setClipStretchMode });

        executeSetClipStretchMode({
            type: 'setClipStretchMode',
            payload: { clipId: 'c1', mode: 'beats' },
        });

        expect(setClipStretchMode).toHaveBeenCalledWith('c1', 'beats');
    });
});
