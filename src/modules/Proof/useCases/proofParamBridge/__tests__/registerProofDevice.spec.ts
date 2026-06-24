import { describe, it, expect, beforeEach, vi } from 'vitest';

import { bridges, type ProofAudioBridge } from '../helpers';
import { registerProofDevice } from '../registerProofDevice';

function makeBridge(): ProofAudioBridge {
    return {
        setParam: vi.fn(),
        reorderModules: vi.fn(),
        resetIntegrated: vi.fn(),
    };
}

describe('registerProofDevice', () => {
    beforeEach(() => {
        bridges.clear();
    });

    it('registers a bridge so the device can be resolved from the registry', () => {
        const bridge = makeBridge();
        registerProofDevice('dev-1', bridge);
        expect(bridges.get('dev-1')).toBe(bridge);
    });

    it('replaces an existing registration for the same device id', () => {
        const first = makeBridge();
        const second = makeBridge();
        registerProofDevice('dev-1', first);
        registerProofDevice('dev-1', second);
        expect(bridges.get('dev-1')).toBe(second);
    });
});
