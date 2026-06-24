import { describe, it, expect, beforeEach } from 'vitest';

import { proofStore, updateProofMeters } from '#/modules/Proof/stores';

import { isProofDevice, type ProofMeterData } from '../ProofNode';

describe('isProofDevice', () => {
    it('should return true only for the proof device type string', () => {
        expect(isProofDevice('proof')).toBe(true);
        expect(isProofDevice('dutch-oven')).toBe(false);
    });
});

// ── Fix 9: engine-side ProofMeterData must stay structurally compatible with
// the shape the Proof store consumes. The compile-time guard in ProofNode.ts
// fails the build on drift; this runtime check proves the engine shape is
// accepted end-to-end by the public store sink. ──
describe('ProofMeterData store compatibility', () => {
    beforeEach(() => {
        proofStore.set({});
    });

    it('feeds an engine-shaped meter frame through the public store sink', () => {
        const frame: ProofMeterData = {
            inputLufs: -18,
            outputLufs: -14,
            outputStLufs: -13,
            integratedLufs: -14,
            truePeakDb: -1.2,
            lra: 6,
            correlation: 0.9,
            limiterGrDb: -2.5,
            dynGr: [-1, -2, -3, -4],
            tapPeaks: [
                { peakL: -10, peakR: -9 },
                { peakL: -11, peakR: -10 },
                { peakL: -12, peakR: -11 },
                { peakL: -13, peakR: -12 },
                { peakL: -14, peakR: -13 },
                { peakL: -15, peakR: -14 },
            ],
            latency: 256,
        };

        // The engine frame is assignable to the public store sink at the call
        // site — the structural compatibility under test.
        updateProofMeters('dev-1', frame);

        const state = proofStore.value?.['dev-1'];
        expect(state?.integratedLufs).toBe(-14);
        expect(state?.truePeakDb).toBe(-1.2);
        expect(state?.tapPeaks[5]).toEqual({ peakL: -15, peakR: -14 });
        expect(state?.latency).toBe(256);
    });
});
