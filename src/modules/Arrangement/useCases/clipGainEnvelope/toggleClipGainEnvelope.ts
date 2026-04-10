import { inject } from '#/infra/di/inject';
import { gainEnvelopeStore } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { getClipGainEnvelope } from './getClipGainEnvelope';

export const toggleClipGainEnvelopeDeps = {
    getClipGainEnvelope,
    gainEnvelopeStore,
};

export const toggleClipGainEnvelope = inject(toggleClipGainEnvelopeDeps)(
    ({ getClipGainEnvelope: getEnv, gainEnvelopeStore: store }) =>
        function toggleClipGainEnvelope(clipId: string): boolean {
            const env = getEnv(clipId);
            env.enabled = !env.enabled;
            store.set(clipId, env);
            return env.enabled;
        }
);
