import { type ClipGainEnvelope, gainEnvelopeStore } from '../../stores/gainEnvelopeStore';

export type { ClipGainEnvelope };

export function getClipGainEnvelope(clipId: string): ClipGainEnvelope {
    let envelope = gainEnvelopeStore.get(clipId);
    if (!envelope) {
        envelope = {
            clipId,
            points: [{ id: `gep-${crypto.randomUUID().slice(0, 6)}`, beatOffset: 0, gainDb: 0 }],
            enabled: true,
        };
        gainEnvelopeStore.set(clipId, envelope);
    }
    return envelope;
}
