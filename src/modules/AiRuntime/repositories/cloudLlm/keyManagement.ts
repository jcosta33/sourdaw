import Anthropic from '@anthropic-ai/sdk';

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

const logger = Container.getInstance().get(Logger);

let apiKey: string | null = null;
let client: Anthropic | null = null;

export function setCloudApiKey(key: string): void {
    apiKey = key;
    client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    logger.info('[Cloud AI] API key set');
}

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
