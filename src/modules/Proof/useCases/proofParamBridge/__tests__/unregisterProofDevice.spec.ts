import { describe, it, expect, beforeEach, vi } from 'vitest';

import { bridges, type ProofAudioBridge } from '../helpers';
import { unregisterProofDevice } from '../unregisterProofDevice';

describe('unregisterProofDevice', () => {
    beforeEach(() => {
        bridges.clear();
    });

    it('removes the bridge so later syncs for that device become no-ops', () => {
        const bridge: ProofAudioBridge = {
            setParam: vi.fn(),
            reorderModules: vi.fn(),
            resetIntegrated: vi.fn(),
        };
        bridges.set('dev-1', bridge);

        unregisterProofDevice('dev-1');

        expect(bridges.has('dev-1')).toBe(false);
    });

    it('is a no-op when the device was never registered', () => {
        expect(() => unregisterProofDevice('missing-device')).not.toThrow();
        expect(bridges.has('missing-device')).toBe(false);
    });
});
