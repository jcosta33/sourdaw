import { type ClipGainEnvelope, gainEnvelopeStore } from '#/modules/Clip/stores/gainEnvelopeStore';

export function getAllClipGainEnvelopes(): Map<string, ClipGainEnvelope> {
    return gainEnvelopeStore;
}
