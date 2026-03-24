import { type ClipGainEnvelope, gainEnvelopeStore } from '#/modules/Arrangement/stores/gainEnvelopeStore';

export function getAllClipGainEnvelopes(): Map<string, ClipGainEnvelope> {
    return gainEnvelopeStore;
}
