import { inject } from '#/infra/di/inject';
import { gainEnvelopeStore } from '#/modules/Arrangement/stores/gainEnvelopeStore';

export const resetClipGainEnvelope = inject({ gainEnvelopeStore })(
    ({ gainEnvelopeStore: store }) =>
        function resetClipGainEnvelope(clipId: string): void {
            store.set(clipId, {
                clipId,
                points: [{ id: `gep-${crypto.randomUUID().slice(0, 6)}`, beatOffset: 0, gainDb: 0 }],
                enabled: true,
            });
        }
);
