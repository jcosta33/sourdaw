import { mapMidiVelocitiesByCurve } from '../../transformers/mapMidiVelocitiesByCurve';

import { applyMidiNoteTransform } from './applyMidiNoteTransform';

export function scaleVelocities(clipId: string, curve: string, minVelocity = 1, maxVelocity = 127): boolean {
    return applyMidiNoteTransform({
        clipId,
        transform: (notes) => mapMidiVelocitiesByCurve({ notes, curve, minVelocity, maxVelocity }),
    });
}
