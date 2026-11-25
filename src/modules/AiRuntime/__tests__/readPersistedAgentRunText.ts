import { stringify } from 'superjson';

import { createAgentRunLocalStorage } from '../stores/agentRunStore';

/**
 * What a reload of the agent run store reads, as the single superjson text the store once kept
 * under one key: a fresh adapter reads `localStorage` exactly as a reload does, never this
 * session's cached value. Null when nothing is stored.
 */
export function readPersistedAgentRunText(): string | null {
    const persisted = createAgentRunLocalStorage().get();
    return persisted === null ? null : stringify(persisted);
}
