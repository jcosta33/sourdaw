import { getEnvelope } from '../../stores/gainEnvelopeStore';

import { sampleGainEnvelopePoints } from './sampleGainEnvelopePoints';

export function getGainAtBeat(clipId: string, beatOffset: number): number {
    const env = getEnvelope(clipId);
    if (!env || !env.enabled || env.points.length === 0) {
        return 0;
    }

    return sampleGainEnvelopePoints(env.points, beatOffset);
}
