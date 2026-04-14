import { type ClipGainEnvelope, getEnvelope, setEnvelope } from '../../stores/gainEnvelopeStore';

export type { ClipGainEnvelope };

export function getClipGainEnvelope(clipId: string): ClipGainEnvelope {
    const envelope = getEnvelope(clipId);
    if (envelope) {
        return envelope;
    }
    return {
        clipId,
        points: [{ id: `gep-default`, beatOffset: 0, gainDb: 0 }],
        enabled: true,
    };
}

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
