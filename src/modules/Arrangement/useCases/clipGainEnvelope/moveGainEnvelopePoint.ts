import { gainEnvelopeStore } from '../../stores/gainEnvelopeStore';

export function moveGainEnvelopePoint(clipId: string, pointId: string, beatOffset: number, gainDb: number): void {
    const env = gainEnvelopeStore.get(clipId);
    if (!env) {
        return;
    }
    const point = env.points.find((p) => p.id === pointId);
    if (!point) {
        return;
    }
    point.beatOffset = Math.max(0, beatOffset);
    point.gainDb = Math.max(-60, Math.min(12, gainDb));
    env.points.sort((a, b) => a.beatOffset - b.beatOffset);
    gainEnvelopeStore.set(clipId, env);
}
