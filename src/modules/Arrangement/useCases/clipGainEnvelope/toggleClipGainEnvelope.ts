import { setEnvelope } from '../../stores/gainEnvelopeStore';

import { ensureClipGainEnvelope } from './getClipGainEnvelope';

export function toggleClipGainEnvelope(clipId: string): boolean {
    const env = ensureClipGainEnvelope(clipId);
    const next = { ...env, enabled: !env.enabled };
    setEnvelope(clipId, next);
    return next.enabled;
}
