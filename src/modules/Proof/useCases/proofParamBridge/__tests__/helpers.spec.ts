import { describe, it, expect, beforeEach, vi } from 'vitest';

import { bridges, type ProofAudioBridge } from '../helpers';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
    updateDevicePatch: vi.fn(),
}));

function makeBridge(): ProofAudioBridge {
    return {
        reorderModules: () => {},
        resetIntegrated: () => {},
    };
}

describe('bridges registry', () => {
    beforeEach(() => {
        bridges.clear();
    });

    it('stores and retrieves a bridge by device id', () => {
        const bridge = makeBridge();
        bridges.set('dev-a', bridge);
        expect(bridges.get('dev-a')).toBe(bridge);
    });

    it('returns undefined for an unregistered device', () => {
        expect(bridges.get('missing')).toBeUndefined();
    });

    it('isolates bridges by device id', () => {
        const a = makeBridge();
        const b = makeBridge();
        bridges.set('dev-a', a);
        bridges.set('dev-b', b);
        expect(bridges.get('dev-a')).toBe(a);
        expect(bridges.get('dev-b')).toBe(b);
    });
});
