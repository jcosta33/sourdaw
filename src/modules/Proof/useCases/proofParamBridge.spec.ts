import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setProofParam } from './proofParamBridge/setProofParam';

describe('setProofParam', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('persists the parameter value', () => {
        const persistDeviceParam = vi.fn();
        injectDependencies(setProofParam, {
            persistDeviceParam,
        });

        setProofParam('device-1', 'gain', 0.5);

        expect(persistDeviceParam).toHaveBeenCalledWith('device-1', 'gain', 0.5);
    });
});
