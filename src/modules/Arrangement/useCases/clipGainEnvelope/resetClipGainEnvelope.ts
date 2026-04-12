import { gainEnvelopeStore } from '../../stores/gainEnvelopeStore';

export function resetClipGainEnvelope(clipId: string): void {
    gainEnvelopeStore.set(clipId, {
        clipId,
        points: [{ id: `gep-${crypto.randomUUID().slice(0, 6)}`, beatOffset: 0, gainDb: 0 }],
        enabled: true,
    });
}
