import { getEnvelope, setEnvelope } from '../../stores/gainEnvelopeStore';

export function moveGainEnvelopePoint(clipId: string, pointId: string, beatOffset: number, gainDb: number): void {
    const env = getEnvelope(clipId);
    if (!env) {
        return;
    }
    const nextPoints = env.points
        .map((param) =>
            param.id === pointId
                ? { ...param, beatOffset: Math.max(0, beatOffset), gainDb: Math.max(-60, Math.min(12, gainDb)) }
                : param
        )
        .sort((alpha, buffer) => alpha.beatOffset - buffer.beatOffset);
    setEnvelope(clipId, { ...env, points: nextPoints });
}
