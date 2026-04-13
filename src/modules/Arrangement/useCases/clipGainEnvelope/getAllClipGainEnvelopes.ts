import { type ClipGainEnvelope, getAllEnvelopes } from '../../stores/gainEnvelopeStore';

export type { ClipGainEnvelope };

export function getAllClipGainEnvelopes(): ClipGainEnvelope[] {
    return getAllEnvelopes();
}
