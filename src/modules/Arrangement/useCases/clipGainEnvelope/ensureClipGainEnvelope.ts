import { type ClipGainEnvelope, getEnvelope, setEnvelope } from '../../stores/gainEnvelopeStore';

export function ensureClipGainEnvelope(clipId: string): ClipGainEnvelope {
    let envelope = getEnvelope(clipId);
    if (!envelope) {
        envelope = {
            clipId,
            points: [{ id: `gep-${crypto.randomUUID().slice(0, 6)}`, beatOffset: 0, gainDb: 0 }],
            enabled: true,
        };
        setEnvelope(clipId, envelope);
    }
    return envelope;
}
