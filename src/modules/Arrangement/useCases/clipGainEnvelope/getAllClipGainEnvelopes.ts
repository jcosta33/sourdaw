import { type ClipGainEnvelope, gainEnvelopeStore } from '#/modules/Arrangement/stores/gainEnvelopeStore';

export type { ClipGainEnvelope };

export function getAllClipGainEnvelopes(): Map<string, ClipGainEnvelope> {
    return gainEnvelopeStore;
}
