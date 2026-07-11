import type Anthropic from '@anthropic-ai/sdk';

// Private process-local auth state. It is intentionally not persisted or
// exported through a module contract.
export const cloudAuthState: { apiKey: string | null; client: Anthropic | null } = {
    apiKey: null,
    client: null,
};
