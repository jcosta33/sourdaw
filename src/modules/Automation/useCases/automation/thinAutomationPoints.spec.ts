import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { thinAutomationPoints } from './thinAutomationPoints';

describe('thinAutomationPoints', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not call rdpSimplify when automation store is empty', () => {
        const rdpSimplify = vi.fn();
        injectDependencies(thinAutomationPoints, { rdpSimplify });

        thinAutomationPoints('lane-1');

        expect(rdpSimplify).not.toHaveBeenCalled();
    });
});
