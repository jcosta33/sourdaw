import { type ClipGainEnvelope, getEnvelope } from '../../stores/gainEnvelopeStore';

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
