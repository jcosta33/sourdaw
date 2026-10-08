import { type AgentRenderHolder } from './exportCancellationState';

/** What a musician is told the assistant was doing, so a message names the render that actually stopped. */
export function agentRenderNoun(holder: AgentRenderHolder): 'measurement' | 'render' {
    return holder === 'agent-measurement' ? 'measurement' : 'render';
}
