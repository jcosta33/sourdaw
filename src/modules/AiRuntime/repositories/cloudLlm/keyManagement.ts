import Anthropic from '@anthropic-ai/sdk';

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

let apiKey: string | null = null;
let client: Anthropic | null = null;

export const setCloudApiKey = inject({ logger })(
    ({ logger }) =>
        function setCloudApiKey(key: string): void {
            apiKey = key;
            client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
            logger.info('[Cloud AI] API key set');
        }
);

export function isCloudAvailable(): boolean {
    return apiKey !== null && client !== null;
}

export function clearCloudApiKey(): void {
    apiKey = null;
    client = null;
}

export function getCloudClient(): Anthropic | null {
    return client;
}
