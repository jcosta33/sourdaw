import { type GainEnvelopePoint, setEnvelope } from '../../stores/gainEnvelopeStore';
import { getClipGainEnvelope } from './getClipGainEnvelope';

export type { GainEnvelopePoint };

export const addGainEnvelopePointDeps = {
    getClipGainEnvelope,
    setEnvelope,
};

export function addGainEnvelopePoint(clipId: string, beatOffset: number, gainDb: number): GainEnvelopePoint {
    const env = getClipGainEnvelope(clipId);
    const point: GainEnvelopePoint = {
        id: `gep-${crypto.randomUUID().slice(0, 6)}`,
        beatOffset: Math.max(0, beatOffset),
        gainDb: Math.max(-60, Math.min(12, gainDb)),
    };

    const idx = env.points.findIndex((p) => p.beatOffset > beatOffset);
    const nextPoints = idx === -1 ? [...env.points, point] : [...env.points.slice(0, idx), point, ...env.points.slice(idx)];
    setEnvelope(clipId, { ...env, points: nextPoints });
    return point;
}
