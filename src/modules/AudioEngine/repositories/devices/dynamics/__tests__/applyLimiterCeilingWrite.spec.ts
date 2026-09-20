import { describe, expect, it } from 'vitest';

import { dbToGain } from '#/utils/audioLevelLaw';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { type OfflineCurveWriteTargets } from '../../../../models/OfflineCurveWriteTargets';
import { applyLimiterCeilingWrite } from '../applyLimiterCeilingWrite';
import { createLimiter } from '../createLimiter';
import { CEILING_CLIP_CURVE_SAMPLES, makeCeilingClipCurve } from '../makeCeilingClipCurve';

/** A factory-built limiter's ceiling pair, the same nodes the resolver returns. */
function limiterCeilingTargets(): OfflineCurveWriteTargets {
    const device = createLimiter(asBaseAudioContext(createMockAudioContext()));
    return {
        ceiling: device.namedNodes!.ceiling as GainNode,
        clipper: device.namedNodes!.clipper as unknown as WaveShaperNode,
    };
}

function curveOf(targets: OfflineCurveWriteTargets): Float32Array {
    const curve = (targets.clipper as unknown as { curve: Float32Array | null }).curve;
    if (!curve) {
        throw new Error('expected the clipper to carry a curve');
    }
    return curve;
}

/** One float32 ULP near the ceiling, plus slack: the curve stores float32 samples. */
const FLOAT32_TOLERANCE = 1e-6;

describe('applyLimiterCeilingWrite', () => {
    it('moves the ceiling gain and rebuilds the clip curve with the static applier’s law', () => {
        const targets = limiterCeilingTargets();
        const staticCurve = curveOf(targets).slice();

        applyLimiterCeilingWrite(targets, -6);

        const ceilingGain = dbToGain(-6);
        expect(targets.ceiling.gain.value).toBeCloseTo(ceilingGain, 12);
        expect(curveOf(targets)).toEqual(makeCeilingClipCurve(ceilingGain));
        // The gain alone is not the write: a static-only update leaves the
        // factory curve in place, which this reds on.
        expect(curveOf(targets)).not.toEqual(staticCurve);
    });

    it('caps the shaper transfer at the written ceiling', () => {
        const targets = limiterCeilingTargets();
        const ceilingGain = dbToGain(-3);

        applyLimiterCeilingWrite(targets, -3);

        const curve = curveOf(targets);
        expect(curve).toHaveLength(CEILING_CLIP_CURVE_SAMPLES);
        // WaveShaper sends everything past full scale to the endpoints, so the
        // advertised cap is only a cap if the endpoints sit on the ceiling.
        expect(curve[0]).toBeCloseTo(-ceilingGain, 6);
        expect(curve[curve.length - 1]).toBeCloseTo(ceilingGain, 6);
        for (const value of curve) {
            expect(Math.abs(value)).toBeLessThanOrEqual(ceilingGain + FLOAT32_TOLERANCE);
        }
    });

    it('rebuilds on every write instead of holding the first ceiling', () => {
        const targets = limiterCeilingTargets();

        applyLimiterCeilingWrite(targets, -1);
        applyLimiterCeilingWrite(targets, -12);

        expect(targets.ceiling.gain.value).toBeCloseTo(dbToGain(-12), 12);
        expect(curveOf(targets)).toEqual(makeCeilingClipCurve(dbToGain(-12)));
    });
});
