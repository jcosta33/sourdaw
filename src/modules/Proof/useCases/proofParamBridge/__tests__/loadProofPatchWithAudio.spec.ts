import { describe, it, expect, beforeEach, vi } from 'vitest';

import { DEFAULT_PATCH, type ProofPatch } from '../../../models/ProofPatch';
import { getProofState, proofStore, setProofAbBypass } from '../../../stores/proofStore';
import { bridges, type ProofAudioBridge } from '../helpers';
import { loadProofPatchWithAudio } from '../loadProofPatchWithAudio';
import { syncFullPatch } from '../syncFullPatch';

function makeBridge(): ProofAudioBridge & {
    setParam: ReturnType<typeof vi.fn>;
    reorderModules: ReturnType<typeof vi.fn>;
} {
    return {
        setParam: vi.fn(),
        reorderModules: vi.fn(),
        resetIntegrated: vi.fn(),
    };
}

function paramCalls(bridge: ReturnType<typeof makeBridge>): Map<string, number> {
    const map = new Map<string, number>();
    for (const [name, value] of bridge.setParam.mock.calls) {
        map.set(name as string, value as number);
    }
    return map;
}

const DEVICE_ID = 'dev-1';

describe('loadProofPatchWithAudio', () => {
    beforeEach(() => {
        bridges.clear();
        proofStore.set({});
    });

    it('loads the patch into the store and sends the full patch to the engine', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        const patch: ProofPatch = {
            ...DEFAULT_PATCH,
            name: 'Streaming Master',
            presetId: 'streaming',
            limCeiling: -1.5,
        };

        loadProofPatchWithAudio({ deviceId: DEVICE_ID, patch });

        // Store now holds the loaded patch (identity preserved).
        expect(getProofState(DEVICE_ID).patch.presetId).toBe('streaming');
        expect(getProofState(DEVICE_ID).patch.limCeiling).toBe(-1.5);

        // The engine receives the scalar params and the chain reorder.
        const calls = paramCalls(bridge);
        expect(calls.get('lim_ceiling')).toBe(-1.5);
        expect(calls.get('input_gain')).toBe(DEFAULT_PATCH.inputGain);
        expect(bridge.reorderModules).toHaveBeenCalledWith(DEFAULT_PATCH.chainOrder);
    });

    // ── Fix 7: ab_bypass is forwarded on a full sync ──
    it('forwards the runtime A/B compare flag (ab_bypass) on a full sync', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        // Seed an active A/B compare, then run a full sync as preset load would.
        setProofAbBypass({ deviceId: DEVICE_ID, abBypass: true });

        syncFullPatch(DEVICE_ID);

        expect(paramCalls(bridge).get('ab_bypass')).toBe(1);
    });

    it('forwards ab_bypass as 0 when compare is inactive', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        setProofAbBypass({ deviceId: DEVICE_ID, abBypass: false });

        syncFullPatch(DEVICE_ID);

        expect(paramCalls(bridge).get('ab_bypass')).toBe(0);
    });

    it('is a no-op on the engine when no bridge is registered, but still loads the store', () => {
        const patch: ProofPatch = { ...DEFAULT_PATCH, name: 'Local only' };
        expect(() => loadProofPatchWithAudio({ deviceId: 'no-bridge', patch })).not.toThrow();
        expect(getProofState('no-bridge').patch.name).toBe('Local only');
    });
});
