import Anthropic from '@anthropic-ai/sdk';

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { cloudAuthState } from './cloudAuthState';

// SECURITY: this is a local-first DAW. The user supplies their own
// Anthropic API key which is why we pass `dangerouslyAllowBrowser: true`.
// The key never leaves the user's machine except in HTTPS requests to
// api.anthropic.com. Do NOT persist the key in a way that survives page
// reloads without explicit user consent, and never log the key itself.
export const setCloudApiKey = inject({ logger })(
    ({ logger }) =>
        function setCloudApiKey(key: string): void {
            cloudAuthState.apiKey = key;
            cloudAuthState.client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
            logger.info('[Cloud AI] API key set');
        }
);
