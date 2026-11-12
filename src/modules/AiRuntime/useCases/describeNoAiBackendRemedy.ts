import { aiBackendPreferenceStore } from '../stores/aiBackendPreferenceStore';
import { hostedLlmProviderStatusStore } from '../stores/hostedLlmProviderStatusStore';

const NO_AI_BACKEND_REMEDY =
    'This request needs an AI model, and none is available. To run it locally, load the local model in Settings > AI > AI Model Manager. To run it on a hosted provider, add a hosted provider in Settings > AI > Hosted AI provider (desktop app) and choose Hosted provider as the AI execution backend.';

const AUTOMATIC_STAYS_LOCAL =
    'Automatic uses only the local model and never sends requests to a hosted provider.';

/**
 * The one sentence a request that needs a model reads when no backend can run it. A configured hosted
 * provider under Automatic is the case a user is likeliest to misread as broken, so it is named first.
 */
export function describeNoAiBackendRemedy(): string {
    const automatic = (aiBackendPreferenceStore.value ?? 'auto') === 'auto';
    if (automatic && hostedLlmProviderStatusStore.value !== null) {
        return `${AUTOMATIC_STAYS_LOCAL} ${NO_AI_BACKEND_REMEDY}`;
    }
    return NO_AI_BACKEND_REMEDY;
}
