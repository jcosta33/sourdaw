import { gainEnvelopeStore } from '#/modules/Clip/stores/gainEnvelopeStore';
import { getClipGainEnvelope } from './getClipGainEnvelope';

export function toggleClipGainEnvelope(clipId: string): boolean {
    const env = getClipGainEnvelope(clipId);
    env.enabled = !env.enabled;
    gainEnvelopeStore.set(clipId, env);
    return env.enabled;
}
