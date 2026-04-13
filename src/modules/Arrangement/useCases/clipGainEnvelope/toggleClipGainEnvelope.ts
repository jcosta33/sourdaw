import { setEnvelope } from '../../stores/gainEnvelopeStore';
import { getClipGainEnvelope } from './getClipGainEnvelope';

export const toggleClipGainEnvelopeDeps = {
    getClipGainEnvelope,
    setEnvelope,
};

export function toggleClipGainEnvelope(clipId: string): boolean {
    const env = getClipGainEnvelope(clipId);
    const next = { ...env, enabled: !env.enabled };
    setEnvelope(clipId, next);
    return next.enabled;
}
