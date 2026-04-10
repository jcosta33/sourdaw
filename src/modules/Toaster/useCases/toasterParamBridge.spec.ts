import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getFirstToasterDeviceId, setPadEngineImmediate } from './toasterParamBridge';

describe('getFirstToasterDeviceId', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns null when there are no tracks', () => {
        injectDependencies(getFirstToasterDeviceId, {
            getAllTracks: () => [],
        });

        expect(getFirstToasterDeviceId()).toBeNull();
    });
});

describe('setPadEngineImmediate', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not touch the strip when the device is not on any track', () => {
        const getTrackStrip = vi.fn();
        injectDependencies(setPadEngineImmediate, {
            getAllTracks: () => [],
            getTrackStrip,
        });

        setPadEngineImmediate('unknown-device', 0, 0);

        expect(getTrackStrip).not.toHaveBeenCalled();
    });
});
