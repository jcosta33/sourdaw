import { type ClipGainEnvelope, gainEnvelopeStore } from '../../stores/gainEnvelopeStore';

export type { ClipGainEnvelope };

export function getAllClipGainEnvelopes(): Map<string, ClipGainEnvelope> {
    return gainEnvelopeStore;
}
