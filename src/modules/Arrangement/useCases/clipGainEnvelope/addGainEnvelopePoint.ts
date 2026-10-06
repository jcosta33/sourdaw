import { type GainEnvelopePoint, setEnvelope } from '../../stores/gainEnvelopeStore';

import { ensureClipGainEnvelope } from './ensureClipGainEnvelope';

export type { GainEnvelopePoint };

/** `pointId` pins the new point's identity so a dispatched action replays to
 *  the same point everywhere (the action's inverse removes exactly that id). */
export function addGainEnvelopePoint(
    clipId: string,
    beatOffset: number,
    gainDb: number,
    pointId?: string
): GainEnvelopePoint {
    const env = ensureClipGainEnvelope(clipId);
    const point: GainEnvelopePoint = {
        id: pointId ?? `gep-${crypto.randomUUID().slice(0, 6)}`,
        beatOffset: Math.max(0, beatOffset),
        gainDb: Math.max(-60, Math.min(12, gainDb)),
    };

    const idx = env.points.findIndex((param) => param.beatOffset > beatOffset);
    const nextPoints =
        idx === -1 ? [...env.points, point] : [...env.points.slice(0, idx), point, ...env.points.slice(idx)];
    setEnvelope(clipId, { ...env, points: nextPoints });
    return point;
}
