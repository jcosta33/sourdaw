import { getEnvelope, setEnvelope } from '../../stores/gainEnvelopeStore';

export function moveGainEnvelopePoint(clipId: string, pointId: string, beatOffset: number, gainDb: number): void {
    const env = getEnvelope(clipId);
    if (!env) {
        return;
    }
    const nextPoints = env.points
        .map((p) =>
            p.id === pointId
                ? { ...p, beatOffset: Math.max(0, beatOffset), gainDb: Math.max(-60, Math.min(12, gainDb)) }
                : p
        )
        .sort((a, b) => a.beatOffset - b.beatOffset);
    setEnvelope(clipId, { ...env, points: nextPoints });
}
