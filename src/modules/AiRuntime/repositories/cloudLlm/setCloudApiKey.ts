import { CLOUD_MODEL } from './cloudInference/helpers';
import { setCloudProviderConfig } from './setCloudProviderConfig';

// SECURITY: this is a local-first DAW. The user supplies their own
// Anthropic API key which is why we pass `dangerouslyAllowBrowser: true`.
// The key never leaves the user's machine except in HTTPS requests to
// api.anthropic.com. Do NOT persist the key in a way that survives page
// reloads without explicit user consent, and never log the key itself.
export function setCloudApiKey(key: string): void {
    setCloudProviderConfig({
        provider: 'anthropic',
        apiKey: key,
        model: CLOUD_MODEL,
    });
}
