import Anthropic from '@anthropic-ai/sdk';

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { cloudSession } from './cloudSession';

// SECURITY: this is a local-first DAW. The user supplies their own
// Anthropic API key which is why we pass `dangerouslyAllowBrowser: true`.
// The key never leaves the user's machine except in HTTPS requests to
// api.anthropic.com. Do NOT persist the key in a way that survives page
// reloads without explicit user consent, and never log the key itself.
export const setCloudApiKey = inject({ logger })(
    ({ logger }) =>
        function setCloudApiKey(key: string): void {
            const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
            cloudSession.replace_credentials({ api_key: key, client });
            logger.info('[Cloud AI] API key set');
        }
);
