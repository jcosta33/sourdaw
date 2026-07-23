import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

import { bridges, type ProofAudioBridge } from '../helpers';
import { syncDynBands } from '../syncDynBands';
import { syncEqBands } from '../syncEqBands';
import { syncExciter } from '../syncExciter';
import { syncImager } from '../syncImager';

type MockedProofBridge = {
    [K in keyof ProofAudioBridge]: Mock<ProofAudioBridge[K]>;
};

function makeBridge(): MockedProofBridge {
    return {
        setParam: vi.fn<ProofAudioBridge['setParam']>(),
        reorderModules: vi.fn<ProofAudioBridge['reorderModules']>(),
        resetIntegrated: vi.fn<ProofAudioBridge['resetIntegrated']>(),
    };
}

// These four sync* functions all guard on `bridges.get(deviceId)` before
// touching the engine — reachable whenever a device is unregistered or not
// yet attached when a sync fires. Covered here directly since none of the
// higher-level callers (setProofParamWithPatch / syncFullPatch) ever invoke
// them without a bridge already registered.
describe('proofParamBridge sync* no-bridge guards', () => {
    beforeEach(() => {
        bridges.clear();
    });

    it('syncEqBands is a no-op when no bridge is registered for the device', () => {
        expect(() => syncEqBands('missing-device')).not.toThrow();
    });

    it('syncDynBands is a no-op when no bridge is registered for the device', () => {
        expect(() => syncDynBands('missing-device')).not.toThrow();
    });

    it('syncExciter is a no-op when no bridge is registered for the device', () => {
        expect(() => syncExciter('missing-device')).not.toThrow();
    });

    it('syncImager is a no-op when no bridge is registered for the device', () => {
        expect(() => syncImager('missing-device')).not.toThrow();
    });

    it('sends imager band widths and mono-bass params to the registered bridge', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        syncImager('dev-1');

        expect(bridge.setParam).toHaveBeenCalledWith('img_width0', expect.any(Number));
        expect(bridge.setParam).toHaveBeenCalledWith('img_auto_mono_bass', expect.any(Number));
        expect(bridge.setParam).toHaveBeenCalledWith('img_mono_bass_freq', expect.any(Number));
    });
});
