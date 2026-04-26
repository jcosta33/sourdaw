import { getEnvelope, setEnvelope } from '../../stores/gainEnvelopeStore';

export function removeGainEnvelopePoint(clipId: string, pointId: string): void {
    const env = getEnvelope(clipId);
    if (!env) {
        return;
    }
    const nextPoints = env.points.filter((param) => param.id !== pointId);
    if (nextPoints.length === 0) {
        nextPoints.push({ id: `gep-${crypto.randomUUID().slice(0, 6)}`, beatOffset: 0, gainDb: 0 });
    }
    setEnvelope(clipId, { ...env, points: nextPoints });
}
