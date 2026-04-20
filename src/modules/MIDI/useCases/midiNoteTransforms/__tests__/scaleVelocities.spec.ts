import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { applyVelocityCurve } from '#/modules/Arrangement/useCases';

import { scaleVelocities } from '../scaleVelocities';

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    applyVelocityCurve: vi.fn(),
}));

describe('scaleVelocities', () => {
    beforeEach(() => {
        Container.clear();
        vi.mocked(applyVelocityCurve).mockReset();
    });

    it('does not call applyVelocityCurve when the clip has no notes', () => {
        scaleVelocities('missing-clip', 'linear');

        expect(applyVelocityCurve).not.toHaveBeenCalled();
    });
});
