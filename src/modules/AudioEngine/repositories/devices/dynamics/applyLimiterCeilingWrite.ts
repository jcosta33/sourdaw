import { dbToGain } from '#/utils/audioLevelLaw';

import { type OfflineCurveWriteTargets } from '../../../models/OfflineCurveWriteTargets';

import { makeCeilingClipCurve } from './makeCeilingClipCurve';

/**
 * Write one frame-addressed limiter ceiling: the gain trim the knob drives and
 * the clipper curve that actually caps the output, through the same law
 * `applyLimiterParams` applies to a static ceiling value.
 *
 * Called on the offline render's frame scheduler, once per compiled automation
 * point, because neither write is an `AudioParam` the graph can ramp.
 */
export function applyLimiterCeilingWrite(targets: OfflineCurveWriteTargets, ceilingDb: number): void {
    const ceilingGain = dbToGain(ceilingDb);
    targets.ceiling.gain.value = ceilingGain;
    targets.clipper.curve = makeCeilingClipCurve(ceilingGain);
}
