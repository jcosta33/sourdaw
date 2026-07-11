import { cloudAuthState } from './cloudAuthState';

import type Anthropic from '@anthropic-ai/sdk';

type GetCloudClientOutput = Anthropic | null;

export function getCloudClient(): GetCloudClientOutput {
    return cloudAuthState.client;
}
