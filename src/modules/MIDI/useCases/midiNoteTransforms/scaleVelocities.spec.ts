import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { scaleVelocities } from './scaleVelocities';

describe('scaleVelocities', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not call applyVelocityCurve when the clip has no notes', () => {
        const applyVelocityCurve = vi.fn();
        injectDependencies(scaleVelocities, { applyVelocityCurve });

        scaleVelocities('missing-clip', 'linear');

        expect(applyVelocityCurve).not.toHaveBeenCalled();
    });
});
