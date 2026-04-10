import { inject } from '#/infra/di/inject';
import { type ClipGainEnvelope, gainEnvelopeStore } from '#/modules/Arrangement/stores/gainEnvelopeStore';

export type { ClipGainEnvelope };

export const getClipGainEnvelope = inject({ gainEnvelopeStore })(
    ({ gainEnvelopeStore: store }) =>
        function getClipGainEnvelope(clipId: string): ClipGainEnvelope {
            let envelope = store.get(clipId);
            if (!envelope) {
                envelope = {
                    clipId,
                    points: [{ id: `gep-${crypto.randomUUID().slice(0, 6)}`, beatOffset: 0, gainDb: 0 }],
                    enabled: true,
                };
                store.set(clipId, envelope);
            }
            return envelope;
        }
);
