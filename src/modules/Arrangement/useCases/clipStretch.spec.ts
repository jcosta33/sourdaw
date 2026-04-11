import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setClipStretchMode } from './clipStretch/setClipStretchMode';

describe('clip stretch use case', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('setClipStretchMode updates clip stretch mode', () => {
        const updateClip = vi.fn();
        injectDependencies(setClipStretchMode, { updateClip });

        setClipStretchMode('c1', 'beats');

        expect(updateClip).toHaveBeenCalled();
    });
});
