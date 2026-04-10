import { inject } from '#/infra/di/inject';
import { type ClipGainEnvelope, gainEnvelopeStore } from '#/modules/Arrangement/stores/gainEnvelopeStore';

export type { ClipGainEnvelope };

export const getAllClipGainEnvelopes = inject({ gainEnvelopeStore })(
    ({ gainEnvelopeStore: store }) =>
        function getAllClipGainEnvelopes(): Map<string, ClipGainEnvelope> {
            return store;
        }
);
