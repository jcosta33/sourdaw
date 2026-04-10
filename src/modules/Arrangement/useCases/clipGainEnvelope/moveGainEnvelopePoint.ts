import { inject } from '#/infra/di/inject';
import { gainEnvelopeStore } from '#/modules/Arrangement/stores/gainEnvelopeStore';

export const moveGainEnvelopePoint = inject({ gainEnvelopeStore })(
    ({ gainEnvelopeStore: store }) =>
        function moveGainEnvelopePoint(clipId: string, pointId: string, beatOffset: number, gainDb: number): void {
            const env = store.get(clipId);
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
            store.set(clipId, env);
        }
);
