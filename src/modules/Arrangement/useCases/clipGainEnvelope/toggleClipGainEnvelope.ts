import { gainEnvelopeStore } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { getClipGainEnvelope } from './getClipGainEnvelope';

export const toggleClipGainEnvelopeDeps = {
    getClipGainEnvelope,
    gainEnvelopeStore,
};

export function toggleClipGainEnvelope(clipId: string): boolean {
    const env = getClipGainEnvelope(clipId);
    env.enabled = !env.enabled;
    gainEnvelopeStore.set(clipId, env);
    return env.enabled;
}
