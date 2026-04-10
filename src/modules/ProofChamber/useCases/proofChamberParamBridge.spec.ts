import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { updateProofChamberParam } from './proofChamberParamBridge';

describe('updateProofChamberParam', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not call updateDeviceParam when the device is unknown', () => {
        const updateDeviceParam = vi.fn();
        injectDependencies(updateProofChamberParam, {
            getAllTracks: () => [],
            updateDeviceParam,
        });

        updateProofChamberParam('missing-device', 'some_param', 0.5);

        expect(updateDeviceParam).not.toHaveBeenCalled();
    });
});
