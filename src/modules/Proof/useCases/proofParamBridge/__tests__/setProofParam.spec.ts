import { describe, it, expect, beforeEach, vi } from 'vitest';

import { persistDeviceParam } from '#/modules/Arrangement/stores';

import { bridges, type ProofAudioBridge } from '../helpers';
import { setProofParam } from '../setProofParam';

vi.mock('#/modules/Arrangement/stores', () => ({
    persistDeviceParam: vi.fn(),
}));

function makeBridge(): ProofAudioBridge & { setParam: ReturnType<typeof vi.fn> } {
    return {
        setParam: vi.fn(),
        reorderModules: vi.fn(),
        resetIntegrated: vi.fn(),
    };
}

describe('setProofParam', () => {
    beforeEach(() => {
        bridges.clear();
        vi.clearAllMocks();
    });

    it('forwards the param to the registered bridge and persists it', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParam('dev-1', 'lim_ceiling', -1.5);

        expect(bridge.setParam).toHaveBeenCalledWith('lim_ceiling', -1.5);
        expect(persistDeviceParam).toHaveBeenCalledWith('dev-1', 'lim_ceiling', -1.5);
    });

    it('still persists when no bridge is registered for the device', () => {
        setProofParam('unregistered', 'input_gain', 3);

        expect(persistDeviceParam).toHaveBeenCalledWith('unregistered', 'input_gain', 3);
    });
});
