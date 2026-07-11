import { cloudSession } from './cloudSession';

import type Anthropic from '@anthropic-ai/sdk';

type GetCloudClientOutput = Anthropic | null;

export function getCloudClient(): GetCloudClientOutput {
    return cloudSession.get_client();
}
