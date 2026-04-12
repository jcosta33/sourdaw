import { type GainEnvelopePoint, gainEnvelopeStore } from '../../stores/gainEnvelopeStore';
import { getClipGainEnvelope } from './getClipGainEnvelope';

export type { GainEnvelopePoint };

export const addGainEnvelopePointDeps = {
    getClipGainEnvelope,
    gainEnvelopeStore,
};

export function addGainEnvelopePoint(clipId: string, beatOffset: number, gainDb: number): GainEnvelopePoint {
    const env = getClipGainEnvelope(clipId);
    const point: GainEnvelopePoint = {
        id: `gep-${crypto.randomUUID().slice(0, 6)}`,
        beatOffset: Math.max(0, beatOffset),
        gainDb: Math.max(-60, Math.min(12, gainDb)),
    };

    const idx = env.points.findIndex((p) => p.beatOffset > beatOffset);
    if (idx === -1) {
        env.points.push(point);
    } else {
        env.points.splice(idx, 0, point);
    }

    gainEnvelopeStore.set(clipId, env);
    return point;
}
