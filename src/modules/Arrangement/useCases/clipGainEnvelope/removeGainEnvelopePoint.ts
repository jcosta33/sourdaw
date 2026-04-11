import { gainEnvelopeStore } from '#/modules/Arrangement/stores/gainEnvelopeStore';

export function removeGainEnvelopePoint(clipId: string, pointId: string): void {
    const env = gainEnvelopeStore.get(clipId);
    if (!env) {
        return;
    }
    env.points = env.points.filter((p) => p.id !== pointId);
    if (env.points.length === 0) {
        env.points.push({ id: `gep-${crypto.randomUUID().slice(0, 6)}`, beatOffset: 0, gainDb: 0 });
    }
    gainEnvelopeStore.set(clipId, env);
}
